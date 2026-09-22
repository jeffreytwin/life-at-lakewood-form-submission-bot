-- 073: what each floor plan photo shows, so it is only ever looked at once.
--
-- The gallery order the sites use needs to know what a photo shows, and
-- plenty of builders name their pictures nothing a room can be read from:
-- SimplyDwell's are "4638-8-scaled-1.webp", Stock's are a media store's
-- UUID. Those galleries came through in page order and Jeff arranged them
-- by hand (2026-09-22), so the Hub's edit overlay can now ask Claude to
-- look at the pictures.
--
-- Looking costs a request, so the answer is kept here by the picture's own
-- URL: the same photograph on a second plan, or on a later run of the same
-- plan, is free. A null room is an answer too — Claude looked and could
-- not place it — and is kept so it is not paid for twice.
CREATE TABLE IF NOT EXISTS fp_photo_rooms (
  source_url text PRIMARY KEY,
  room text,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fp_photo_rooms IS
  'What a floor plan photo shows, read from the picture by Claude and kept by its URL (photo-rooms.ts).';
COMMENT ON COLUMN fp_photo_rooms.room IS
  'One of the gallery order rooms, or "front" for the street view that leads. Null: looked at, could not be placed.';
