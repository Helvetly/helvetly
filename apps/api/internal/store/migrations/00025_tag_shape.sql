-- +goose Up
-- Tags take one shape everywhere (internal/tags): ASCII letters, digits and inner hyphens, at most 32 characters.
-- A tag already in that shape is kept as typed; any other is spelled out the way tags.Slug does it ("Büro Material"
-- → buero-material), one left empty is dropped, and a repeat (ignoring case) keeps its first place.
-- +goose StatementBegin
CREATE FUNCTION pg_temp.tag_shape(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN t ~ '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$' AND char_length(t) <= 32 THEN t
        ELSE rtrim(left(btrim(regexp_replace(
            translate(
                replace(replace(replace(replace(lower(t), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
                'àáâãåèéêëìíîïòóôõùúûýÿçñ', 'aaaaaeeeeiiiiooooouuuyycn'),
            '[^a-z0-9]+', '-', 'g'), '-'), 32), '-')
    END
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION pg_temp.tags_shape(list text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(array_agg(tag ORDER BY ord), '{}')
    FROM (
        SELECT DISTINCT ON (lower(tag)) tag, ord
        FROM (SELECT pg_temp.tag_shape(t) AS tag, ord FROM unnest(list) WITH ORDINALITY AS u(t, ord)) shaped
        WHERE tag <> ''
        ORDER BY lower(tag), ord
    ) firsts
$$;
-- +goose StatementEnd
UPDATE clients SET tags = pg_temp.tags_shape(tags) WHERE tags <> pg_temp.tags_shape(tags);
UPDATE documents SET tags = pg_temp.tags_shape(tags) WHERE tags <> pg_temp.tags_shape(tags);
-- pg_temp lives as long as the connection, which goose may reuse.
DROP FUNCTION pg_temp.tags_shape(text[]);
DROP FUNCTION pg_temp.tag_shape(text);

-- +goose Down
SELECT 1;
