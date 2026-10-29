# Mail art

The art at the top of Token Circles mails, and the master it is cut from.

| File                          | What                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a1-engraved-night.jpg`       | The master, "Engraved orbits, night plate": 1536 x 1024, a JPEG (quality 93, 4:4:4) of the PNG the image model returned. Kept so a new cut starts from the original, not from an older cut. |
| `a1-engraved-night.prompt.md` | The prompt that made it, with the house style every mail image follows. Made with Codex image_gen; the journey plan of 2026-10-11 chose it from six images in three directions.             |

The mails load their cuts from the app, out of `frontend/public/email/`:

| File                           | Pixels     | Shown at  | Used by                                   |
| ------------------------------ | ---------- | --------- | ----------------------------------------- |
| `hero-engraved-night-v1.jpg`   | 1200 x 560 | 600 x 280 | the welcome                               |
| `banner-engraved-night-v1.jpg` | 1199 x 360 | 600 x 180 | every other mail on the 2026-10-11 layout |
| `orbit.gif`                    | 144 x 144  | 72 x 72   | no mail now; kept for mails already sent  |

Both cuts are centre crops of the master scaled to their width: the hero is the middle 560 rows at
1200 wide, the banner the middle 360 rows at 1199 wide. How they were compressed was not recorded.
`magick -quality 64` on the same crop gives a 155 KB hero, over what the size test allows, so a new
cut needs a stronger encoder or a lower quality.

## Rules

- **Never overwrite or delete a file in `frontend/public/email/`.** A mail already sent points at
  its image for as long as it is kept. New art, or a new cut of the same art, gets a new name
  (`hero-engraved-night-v2.jpg`) and the template points at that.
- **That rule is what makes the cache safe.** `frontend/public/_headers` serves `/email/*` as
  immutable for a year.
- **Keep the cuts light.** `frontend/src/__tests__/emailAssets.test.ts` holds the hero under 120 KB
  and the banner under 80 KB, and checks that every image a template names exists.
- **No text in the art.** Every prompt forbids letters, numerals, logos and marks, and every result
  was read by OCR (only noise came back) and checked on a zoomed contact sheet before use.
- **The art is an `<img>` above live text, never a CSS background.** Gmail's desktop webmail draws
  background images badly and classic Outlook needs VML for them. The layout is `renderMail` in
  `worker/src/emailTemplates.ts`.
