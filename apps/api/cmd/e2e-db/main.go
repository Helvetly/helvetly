// The browser suite owns one disposable schema, never the local development schema.
package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	if len(os.Args) != 3 || !regexp.MustCompile(`^helvetly_e2e_[a-z0-9_]+$`).MatchString(os.Args[2]) {
		panic("expected create|drop and a helvetly_e2e_ schema name")
	}
	databaseURL := os.Getenv("DATABASE_URL") // set by e2e/scripts/e2e-server.mjs: the database of compose.e2e.yml
	dbURL, err := url.Parse(databaseURL)
	if err != nil || dbURL == nil || (dbURL.Hostname() != "localhost" && dbURL.Hostname() != "127.0.0.1" && dbURL.Hostname() != "::1") {
		panic("refusing non-local E2E database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		panic("could not connect to the local E2E database")
	}
	defer conn.Close(ctx)
	var statement string
	switch os.Args[1] {
	case "create":
		statement = "CREATE SCHEMA " + pgx.Identifier{os.Args[2]}.Sanitize()
	case "drop":
		statement = "DROP SCHEMA IF EXISTS " + pgx.Identifier{os.Args[2]}.Sanitize() + " CASCADE"
	default:
		panic("unknown E2E database action")
	}
	if _, err = conn.Exec(ctx, statement); err != nil {
		panic(fmt.Sprintf("E2E database %s failed", os.Args[1]))
	}
	if err = bucket(ctx, os.Args[1], strings.ReplaceAll(os.Args[2], "_", "-")); err != nil {
		panic(fmt.Sprintf("E2E storage %s failed: %v", os.Args[1], err))
	}
}

func bucket(ctx context.Context, action, name string) error {
	endpoint := os.Getenv("S3_ENDPOINT")
	u, err := url.Parse(endpoint)
	if err != nil || u == nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		return fmt.Errorf("refusing non-local E2E storage")
	}
	s3, err := minio.New(u.Host, &minio.Options{Secure: u.Scheme == "https", Region: "us-east-1",
		Creds: credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), "")})
	if err != nil {
		return err
	}
	if action == "create" {
		for range 60 {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			err = s3.MakeBucket(ctx, name, minio.MakeBucketOptions{Region: "us-east-1"})
			if err == nil || minio.ToErrorResponse(err).Code == "BucketAlreadyOwnedByYou" {
				return nil
			}
			if minio.ToErrorResponse(err).Code == "AccessDenied" {
				return err
			}
			time.Sleep(500 * time.Millisecond)
		}
		return err
	}
	for item := range s3.ListObjects(ctx, name, minio.ListObjectsOptions{Recursive: true}) {
		if item.Err != nil {
			if minio.ToErrorResponse(item.Err).Code == "NoSuchBucket" {
				return nil
			}
			return item.Err
		}
		if err := s3.RemoveObject(ctx, name, item.Key, minio.RemoveObjectOptions{}); err != nil {
			return err
		}
	}
	return s3.RemoveBucket(ctx, name)
}
