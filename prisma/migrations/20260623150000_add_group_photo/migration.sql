-- Group display image (Facebook og:image) captured during scraping, so the
-- Groups page can show an avatar like the Posts page shows author photos.
-- Nullable so existing rows are unaffected (they render the placeholder icon).

ALTER TABLE "GroupInfo" ADD COLUMN "groupPhoto" TEXT;
