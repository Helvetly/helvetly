package engagements

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

var noticeKinds = []struct{ kind, heading, icon, description string }{
	{"draft_created", "Invoice drafts created", "＋", "Review the draft invoices before issuing them."},
	{"period_closed", "Periods ready to invoice", "✓", "Review the work recorded in each period before billing your client."},
	{"ending_soon", "Ending soon", "◷", "Check the end dates and confirm what’s left to deliver."},
	{"under_pace", "Behind pace", "↗", "Review recorded work and make a plan for any remaining commitments."},
}

// DigestLine is one line of a digest section; Path is relative to the platform origin.
type DigestLine struct{ Text, Path string }

// DigestSource adds a section to a workspace's digest (instalments: "Instalments"); no lines, no section.
// DigestWorkspaces lists the workspaces it has lines for, so they get a digest without engagement notices.
type DigestSource interface {
	DigestWorkspaces(ctx context.Context, now time.Time) ([]store.Workspace, error)
	DigestSection(ctx context.Context, ws store.Workspace, now time.Time) (heading string, lines []DigestLine, err error)
}

// AddDigestSource adds src's section to every digest.
func (s *Service) AddDigestSource(src DigestSource) { s.sources = append(s.sources, src) }

type digestSection struct {
	heading, icon, description string
	lines                      []DigestLine
}

// digestMessage lists the notices grouped by kind, each linking to its engagement, then the sources' sections.
func digestMessage(to, workspace string, notices []store.EngagementNotice, publicURL string, extra ...digestSection) mail.Message {
	var sections []digestSection
	for _, k := range noticeKinds {
		var lines []DigestLine
		for _, n := range notices {
			if n.Kind == k.kind {
				lines = append(lines, DigestLine{Text: fmt.Sprintf("#%d %s", n.Number, n.Title), Path: "/engagements?id=" + url.QueryEscape(n.EngagementID)})
			}
		}
		if len(lines) > 0 {
			sections = append(sections, digestSection{heading: k.heading, icon: k.icon, description: k.description, lines: lines})
		}
	}
	sections = append(sections, extra...)
	l := mail.NewLetter("en").Lead("Here’s what needs a look in " + workspace + ". Open an item to review it.")
	updates := 0
	for _, sec := range sections {
		links := make([]mail.Link, 0, len(sec.lines))
		for _, line := range sec.lines {
			links = append(links, mail.Link{Label: line.Text, URL: publicURL + line.Path})
		}
		l.Section(sec.heading, sec.icon, sec.description, links...)
		updates += len(links)
	}
	subject := fmt.Sprintf("Workspace roundup: %d updates", updates)
	if updates == 1 {
		subject = "Workspace roundup: 1 update"
	}
	return mail.Message{To: []string{to}, Subject: subject, Members: true,
		Text: l.Text(), HTML: mail.Title("Your workspace roundup") + l.HTML()}
}

// digestFrom is the local hour the daily digest may go out.
const digestFrom = 7

// sendDigests mails each workspace's owners and admins their un-notified notices, from 07:00 local time.
// Marking them notified is what makes it once per batch.
func (s *Service) sendDigests(ctx context.Context, now time.Time) {
	if s.mailer == nil {
		return
	}
	workspaces, err := s.db.DigestWorkspaces(ctx)
	if err != nil {
		s.log.ErrorContext(ctx, "engagement digest workspaces", "error", err)
		return
	}
	for _, src := range s.sources {
		more, err := src.DigestWorkspaces(ctx, now)
		if err != nil {
			s.log.ErrorContext(ctx, "digest source workspaces", "error", err)
			continue
		}
		for _, ws := range more {
			if !slices.ContainsFunc(workspaces, func(w store.Workspace) bool { return w.ID == ws.ID }) {
				workspaces = append(workspaces, ws)
			}
		}
	}
	for _, ws := range workspaces {
		if now.In(ws.Location()).Hour() < digestFrom {
			continue
		}
		if err := s.digest(ctx, ws, now); err != nil {
			s.log.ErrorContext(ctx, "engagement digest", "workspace", ws.ID, "error", err)
		}
	}
}

// errNotSent rolls back a digest's claims when every send failed, so the next run tries again.
var errNotSent = errors.New("digest not sent")

// digest claims the pending notices (and, without notices, the day) in the transaction that sends them, so two
// instances running the job at once send each digest once.
func (s *Service) digest(ctx context.Context, ws store.Workspace, now time.Time) error {
	if on, err := s.db.FeatureAllowed(ctx, ws.ID, store.FeatureEngagementAutomation); err != nil || !on {
		return err // a scheduled digest is an automation: it waits for a plan with them
	}
	if wait, err := s.db.AutomationWaits(ctx, ws.ID, store.AutomationActions, store.EmailRecipients); err != nil || wait {
		return err // no room for it this month at this cap: the notices wait for a new month or a bigger cap
	}
	var sections []digestSection
	for _, src := range s.sources {
		heading, lines, err := src.DigestSection(ctx, ws, now)
		if err != nil {
			s.log.ErrorContext(ctx, "digest section", "workspace", ws.ID, "error", err)
			continue
		}
		if len(lines) > 0 {
			sections = append(sections, digestSection{heading: heading, icon: "◷", lines: lines})
		}
	}
	_, emails, err := s.db.DigestRecipients(ctx, ws.ID)
	if err != nil || len(emails) == 0 {
		return err // no one to tell: the notices wait
	}
	var actions []string // one automatic action per recipient
	err = s.db.Tx(ctx, func(q store.Q) error {
		notices, err := q.ClaimNotices(ctx, ws.ID, now)
		if err != nil {
			return err
		}
		if len(sections) > 0 { // sections have no notified mark: without notices they go once a day
			first, err := q.ClaimDigestDay(ctx, ws.ID, ws.Today(now))
			if err != nil {
				return err
			}
			if !first && len(notices) == 0 {
				return nil
			}
		}
		if len(notices) == 0 && len(sections) == 0 {
			return nil
		}
		occurrence := ws.Today(now) + ":day"
		if len(notices) > 0 {
			occurrence = ws.Today(now) + ":" + notices[0].ID
		}
		// Room for every recipient or the digest waits (claims and reservations roll back together). Reserved in this
		// transaction: a second connection while it holds the claims deadlocks concurrent instances on the pool.
		for _, to := range emails {
			actions = append(actions, "engagements.digest:"+occurrence+":"+to)
			if err := q.ReserveAutomation(ctx, ws.ID, actions[len(actions)-1], now); err != nil {
				return err
			}
		}
		sent := 0
		for i, to := range emails {
			m := digestMessage(to, ws.Name, notices, s.publicURL, sections...)
			m.Workspace = ws.ID
			if err := s.mailer.Send(ctx, m); err != nil {
				s.log.ErrorContext(ctx, "engagement digest mail", "workspace", ws.ID, "error", err)
				continue
			}
			if err := q.SettleAutomation(ctx, ws.ID, actions[i], now); err != nil {
				return err
			}
			sent++
		}
		if sent == 0 {
			return errNotSent
		}
		return nil
	})
	if err == nil || errors.Is(err, errNotSent) || errors.Is(err, store.ErrAdmissionDenied) {
		// what did not go is given back: a failed recipient is not retried, a digest that waits reserves again
		for _, a := range actions {
			if rerr := s.db.ReleaseAutomation(context.WithoutCancel(ctx), ws.ID, a); rerr != nil {
				return rerr
			}
		}
		return nil
	}
	return err
}
