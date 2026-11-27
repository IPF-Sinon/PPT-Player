# Tauri spike

Answers three questions before any decision to migrate the shell. It is not a port:
nothing here is wired to the real app, and the Electron code is untouched.

1. **Cold start and size** — milliseconds from process start to the first painted
   frame, plus the NSIS installer size, to compare against the Electron lite build.
2. **WebView2 rendering** — a slide mock, a translucent blurred toolbar, and canvas
   ink, to confirm the runtime draws what the player depends on.
3. **Range streaming** — whether the custom deck protocol answers a byte range with
   206 and a correct Content-Range, which is what pdf.js needs to stream a converted
   deck instead of downloading all of it.

Run by .github/workflows/spike.yml on windows-latest. The build logs the numbers and
uploads the exe and installer, so the decision rests on measurements rather than on
the vendor's marketing.
