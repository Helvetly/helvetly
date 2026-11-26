package mail

import (
	"context"
	"errors"
)

// Meter counts business email against a workspace's monthly allowance (billing.Service): ReserveEmail holds the
// recipients before the send, or refuses with the error to answer (also a message whose attachments are too large);
// settle(true) records them used, settle(false) releases them.
type Meter interface {
	ReserveEmail(ctx context.Context, workspaceID string, recipients, attachmentBytes int64) (settle func(sent bool), err error)
}

// Sending is what sends a message (*Sender, or Metered around it).
type Sending interface {
	Send(ctx context.Context, m Message) error
}

// Metered sends through Sender, counting each message with a Workspace against Meter: reserved before SMTP, used
// once the server accepted it, released when it surely was not sent, and kept reserved when the outcome is unknown
// (ErrUncertain), so a blind retry cannot send for free. A message without a Workspace (sign-in, security) or marked
// Uncounted (a portal sign-in code) is never counted or refused.
type Metered struct {
	Sender Sending
	Meter  Meter
}

func (m Metered) Send(ctx context.Context, msg Message) error {
	if msg.Workspace == "" || msg.Uncounted || m.Meter == nil {
		return m.Sender.Send(ctx, msg)
	}
	var attached int64
	for _, a := range msg.Attachments {
		attached += int64(len(a.Data))
	}
	settle, err := m.Meter.ReserveEmail(ctx, msg.Workspace, int64(len(msg.To)+len(msg.Cc)+len(msg.Bcc)), attached)
	if err != nil {
		return err
	}
	err = m.Sender.Send(ctx, msg)
	if !errors.Is(err, ErrUncertain) {
		settle(err == nil)
	}
	return err
}
