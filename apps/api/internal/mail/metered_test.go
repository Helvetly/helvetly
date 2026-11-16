package mail

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"

	"helvetly.com/api/internal/config"
)

type fakeSending struct {
	err  error
	sent []Message
}

func (f *fakeSending) Send(_ context.Context, m Message) error {
	if f.err == nil {
		f.sent = append(f.sent, m)
	}
	return f.err
}

type fakeEmailMeter struct {
	refuse               error
	recipients, attached int64
	settled              []bool
}

func (f *fakeEmailMeter) ReserveEmail(_ context.Context, _ string, recipients, attachmentBytes int64) (func(bool), error) {
	if f.refuse != nil {
		return nil, f.refuse
	}
	f.recipients, f.attached = recipients, attachmentBytes
	return func(sent bool) { f.settled = append(f.settled, sent) }, nil
}

func TestMeteredCountsBusinessEmailOnly(t *testing.T) {
	refused := errors.New("limit_reached")
	business := Message{Workspace: "wsp_1", To: []string{"a@x.ch", "b@x.ch"}, Cc: []string{"c@x.ch"},
		Attachments: []Attachment{{Data: make([]byte, 700)}, {Data: make([]byte, 300)}}}
	for _, tc := range []struct {
		name    string
		msg     Message
		meter   *fakeEmailMeter
		sendErr error
		wantErr error
		sent    int
		settled string
	}{
		{name: "accepted: used", msg: business, meter: &fakeEmailMeter{}, sent: 1, settled: "[true]"},
		{name: "refused by the server: released", msg: business, meter: &fakeEmailMeter{}, sendErr: errors.New("smtp RCPT TO: 550"),
			wantErr: errors.New("smtp RCPT TO: 550"), settled: "[false]"},
		{name: "outcome unknown: kept reserved", msg: business, meter: &fakeEmailMeter{}, sendErr: fmt.Errorf("smtp: %w: EOF", ErrUncertain),
			wantErr: ErrUncertain, settled: "[]"},
		{name: "allowance used up: not sent", msg: business, meter: &fakeEmailMeter{refuse: refused}, wantErr: refused, settled: "[]"},
		{name: "sign-in code: never counted, never refused", msg: Message{To: []string{"me@x.ch"}}, meter: &fakeEmailMeter{refuse: refused},
			sent: 1, settled: "[]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sender := &fakeSending{err: tc.sendErr}
			err := Metered{Sender: sender, Meter: tc.meter}.Send(context.Background(), tc.msg)
			if (tc.wantErr == nil) != (err == nil) || (tc.wantErr != nil && !errors.Is(err, tc.wantErr) && err.Error() != tc.wantErr.Error()) {
				t.Fatalf("err %v, want %v", err, tc.wantErr)
			}
			if len(sender.sent) != tc.sent || fmt.Sprint(tc.meter.settled) != tc.settled {
				t.Fatalf("sent %d settled %v, want %d %s", len(sender.sent), tc.meter.settled, tc.sent, tc.settled)
			}
			if tc.msg.Workspace != "" && tc.meter.refuse == nil && (tc.meter.recipients != 3 || tc.meter.attached != 1000) {
				t.Fatalf("reserved %d recipients, %d attachment bytes; want 3 (To and Cc) and 1000", tc.meter.recipients, tc.meter.attached)
			}
		})
	}
}

// fakeSMTP accepts one message up to its final dot, then answers final, or hangs up when final is "".
func fakeSMTP(t *testing.T, final string) config.SMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		fmt.Fprint(conn, "220 fake\r\n")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch cmd := strings.ToUpper(strings.TrimSpace(line)); {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				fmt.Fprint(conn, "250 fake\r\n")
			case cmd == "DATA":
				fmt.Fprint(conn, "354 go on\r\n")
				for {
					if l, err := r.ReadString('\n'); err != nil || l == ".\r\n" {
						break
					}
				}
				if final == "" {
					return // the message went out; no answer comes
				}
				fmt.Fprint(conn, final+"\r\n")
			case cmd == "QUIT":
				fmt.Fprint(conn, "221 bye\r\n")
				return
			default:
				fmt.Fprint(conn, "250 ok\r\n")
			}
		}
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	return config.SMTP{Host: "127.0.0.1", Port: port, TLS: "none", From: "Helvetly <noreply@helvetly.test>"}
}

// TestSendTellsAnUnknownOutcomeFromARefusal: a server that hangs up after the whole message may have accepted it
// (ErrUncertain); one that answers with an error code refused it.
func TestSendTellsAnUnknownOutcomeFromARefusal(t *testing.T) {
	msg := Message{To: []string{"a@x.ch"}, Subject: "s", Text: "t"}
	for _, tc := range []struct {
		final     string
		uncertain bool
		ok        bool
	}{{"250 queued", false, true}, {"554 rejected", false, false}, {"", true, false}} {
		err := NewSender(fakeSMTP(t, tc.final), "https://helvetly.test").Send(context.Background(), msg)
		if (err == nil) != tc.ok || errors.Is(err, ErrUncertain) != tc.uncertain {
			t.Fatalf("final %q: err %v, want uncertain=%v ok=%v", tc.final, err, tc.uncertain, tc.ok)
		}
	}
}
