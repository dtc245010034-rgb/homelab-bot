# GEMINI Agent — Bộ nhớ dài hạn (index)

File này là INDEX, không chứa nội dung chi tiết. Mỗi dòng trỏ tới 1 file trong `memory/`.

Format mỗi dòng: `- [topic-slug](memory/topic-slug.md) — mô tả ngắn`

Giới hạn ~200 dòng — quá ngưỡng, dòng cũ nhất sẽ bị agent tự bỏ khỏi index (file `memory/*.md` tương ứng vẫn còn, chỉ mất "con trỏ").

<!-- Các dòng chủ đề do agent tự thêm qua tool remember() sẽ nằm dưới đây -->
