package uploads

import "testing"

// Cloudflare refuses request bodies over 100 MB; the frontend packs at most 95 MiB of files into one request.
func TestMaxRequestFitsCloudflareWithFramingHeadroom(t *testing.T) {
	if MaxRequestBytes >= 100_000_000 || MaxRequestBytes < 95<<20+32<<10 {
		t.Fatalf("MaxRequestBytes = %d", MaxRequestBytes)
	}
}

func TestMaxFileIs25MB(t *testing.T) {
	if MaxFileBytes != 25<<20 || MaxFileBytes > MaxRequestBytes {
		t.Fatalf("MaxFileBytes = %d", MaxFileBytes)
	}
}
