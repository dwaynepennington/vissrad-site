tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (SIMD + LSTM build), Apache-2.0
(LICENSE in this folder; the Tesseract OCR engine is also Apache-2.0).
eng.traineddata.gz is the English "tessdata_fast" model (github.com/tesseract-ocr/tessdata_fast,
Apache-2.0), gzipped. It read small drawing text more reliably than best_int in testing.
Used by VREST "Scan drawings (PDF)" to read sheets that have no text layer.
Loaded only when a sheet needs OCR; everything runs in the browser.
