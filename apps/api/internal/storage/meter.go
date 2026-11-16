package storage

import (
	"context"
	"net/http"
)

// Meter counts downloads against a workspace's monthly download allowance (billing.Service): ReserveDownload holds up
// to n bytes before a response starts, or refuses with the error to answer; settle records the bytes actually sent.
type Meter interface {
	ReserveDownload(ctx context.Context, workspaceID string, n int64) (settle func(sent int64), err error)
}

// ErrDownloadsUsedUp is what a refused download tells someone who may not see the workspace's plan (a client, a media
// link).
const ErrDownloadsUsedUp = "This file cannot be downloaded right now: the workspace has used its downloads for this month. Ask its owner to make room or try again next month."

// UseMeter counts every download of a workspace's file (Serve, the media links and Metered): presigned links, which
// storage serves as often as anyone asks, are no longer handed out; the bytes go through the API or MEDIA_URL.
func (s *S3) UseMeter(m Meter) { s.meter = m }

// DownloadMeter is the meter set with UseMeter, nil without.
func (s *S3) DownloadMeter() Meter { return s.meter }

// MeterOf is src's download meter: nil for a bucket without one (billing off, a fake in tests).
func MeterOf(src any) Meter {
	if m, ok := src.(interface{ DownloadMeter() Meter }); ok {
		return m.DownloadMeter()
	}
	return nil
}

// Metered answers with send, a response of at most size body bytes, counted against workspaceID's downloads: reserved
// before the first byte and settled with the bytes written, however the response ends (a range, a 304, a client
// that hangs up half-way). A refusal is returned before anything is written. A nil meter, no workspace (a personal
// avatar) or a HEAD request counts nothing.
func Metered(w http.ResponseWriter, r *http.Request, m Meter, workspaceID string, size int64, send func(http.ResponseWriter)) error {
	if m == nil || workspaceID == "" || r.Method == http.MethodHead {
		send(w)
		return nil
	}
	settle, err := m.ReserveDownload(r.Context(), workspaceID, size)
	if err != nil {
		return err
	}
	cw := &countingWriter{ResponseWriter: w}
	defer func() { settle(cw.n) }()
	send(cw)
	return nil
}

type countingWriter struct {
	http.ResponseWriter
	n int64
}

func (c *countingWriter) Write(b []byte) (int, error) {
	n, err := c.ResponseWriter.Write(b)
	c.n += int64(n)
	return n, err
}

func (c *countingWriter) Unwrap() http.ResponseWriter { return c.ResponseWriter }
