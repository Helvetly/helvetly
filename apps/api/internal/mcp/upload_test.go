package mcp_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// memStorage keeps uploaded objects in memory and presigns fake URLs.
type memStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *memStorage) Put(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(body)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = b
	return err
}

func (m *memStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return nopCloser{bytes.NewReader(m.objects[key])}, nil
}

func (m *memStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key, nil
}

func (m *memStorage) ProxyDownloads() bool { return false }

func (m *memStorage) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}

type nopCloser struct{ *bytes.Reader }

func (nopCloser) Close() error { return nil }

// TestUploadAndDownloadThroughTools: a file sent to an upload tool as base64 is stored once (the SHA-256 rules
// apply: the same bytes again answer the stored file), listed, and its download tool answers a short-lived URL.
func TestUploadAndDownloadThroughTools(t *testing.T) {
	e := newEnv(t)
	_, token := e.person("", "owner", nil, "write:clients")
	created := e.call(token, "create_client", map[string]any{"body": map[string]any{"name": "Files"}})
	var client struct{ Data struct{ ID string } }
	_ = json.Unmarshal([]byte(created.Content[0].Text), &client)

	file := map[string]any{"filename": "contract.pdf", "content_base64": base64.StdEncoding.EncodeToString([]byte("%PDF-1.7 contract"))}
	upload := func() toolResult {
		return e.call(token, "upload_client_files", map[string]any{"id": client.Data.ID, "body": map[string]any{"files[]": []any{file}}})
	}
	first, again := upload(), upload()
	if first.IsError || again.IsError || first.Content[0].Text[:40] != again.Content[0].Text[:40] {
		t.Fatalf("the same bytes twice answer the stored file: %+v, %+v", first, again)
	}
	listed := e.call(token, "list_client_files", map[string]any{"id": client.Data.ID})
	var files struct{ Data []struct{ ID, Name string } }
	if err := json.Unmarshal([]byte(listed.Content[0].Text), &files); err != nil || len(files.Data) != 1 {
		t.Fatalf("list: %s", listed.Content[0].Text)
	}
	got := e.call(token, "download_client_file", map[string]any{"id": client.Data.ID, "file_id": files.Data[0].ID})
	if got.IsError || !strings.Contains(got.Content[0].Text, `"download_url":"https://s3.test/`) {
		t.Fatalf("download: %+v", got)
	}
}
