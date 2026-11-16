package engagements

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/url"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

var noticeKinds = []struct{ kind, heading string }{
	{"draft_created", "Invoice drafts created"},
	{"period_closed", "Periods ready to invoice"},
	{"ending_soon", "Ending soon"},
	{"under_pace", "Behind pace"},
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
	heading string
	lines   []DigestLine
}

// digestMessage lists the notices grouped by kind, each linking to its engagement, then the sources' sections.
func digestMessage(to string, notices []store.EngagementNotice, publicURL string, extra ...digestSection) mail.Message {
	var sections []digestSection
	for _, k := range noticeKinds {
		var lines []DigestLine
		for _, n := range notices {
			if n.Kind == k.kind {
				lines = append(lines, DigestLine{Text: fmt.Sprintf("#%d %s", n.Number, n.Title), Path: "/engagements?id=" + url.QueryEscape(n.EngagementID)})
			}
		}
		if len(lines) > 0 {
			sections = append(sections, digestSection{k.heading, lines})
		}
	}
	sections = append(sections, extra...)
	var text, page strings.Builder
	updates := 0
	for _, sec := range sections {
		fmt.Fprintf(&text, "%s\n", sec.heading)
		fmt.Fprintf(&page, "<h3>%s</h3><ul>", html.EscapeString(sec.heading))
		for _, l := range sec.lines {
			link := publicURL + l.Path
			fmt.Fprintf(&text, "- %s: %s\n", l.Text, link)
			fmt.Fprintf(&page, `<li><a href="%s">%s</a></li>`, html.EscapeString(link), html.EscapeString(l.Text))
		}
		updates += len(sec.lines)
		text.WriteString("\n")
		page.WriteString("</ul>")
	}
	return mail.Message{To: []string{to}, Subject: fmt.Sprintf("Engagements: %d updates", updates),
		Text: text.String(), HTML: "<p>Your engagements need attention.</p>" + page.String()}
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
	var sections []digestSection
	for _, src := range s.sources {
		heading, lines, err := src.DigestSection(ctx, ws, now)
		if err != nil {
			s.log.ErrorContext(ctx, "digest section", "workspace", ws.ID, "error", err)
			continue
		}
		if len(lines) > 0 {
			sections = append(sections, digestSection{heading, lines})
		}
	}
	_, emails, err := s.db.DigestRecipients(ctx, ws.ID)
	if err != nil || len(emails) == 0 {
		return err // no one to tell: the notices wait
	}
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
		sent := 0
		for _, to := range emails {
			if err := s.mailer.Send(ctx, digestMessage(to, notices, s.publicURL, sections...)); err != nil {
				s.log.ErrorContext(ctx, "engagement digest mail", "workspace", ws.ID, "error", err)
				continue
			}
			sent++
		}
		if sent == 0 {
			return errNotSent
		}
		return nil
	})
	if errors.Is(err, errNotSent) {
		return nil
	}
	return err
}
