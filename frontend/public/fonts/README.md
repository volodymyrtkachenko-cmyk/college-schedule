# Офлайн-шрифти для друку розкладу (Official Print Sheet)

Для точної метричної відповідності друкованої форми на Linux-сервері (де немає стандартних Windows-шрифтів Arial, Courier New, Times New Roman):

1. **Системний пакет (рекомендовано для Docker/Linux):**
   ```bash
   apt-get update && apt-get install -y fonts-croscore
   ```
   Він містить офіційні шрифти Google Croscore (`Arimo`, `Cousine`, `Tinos`), які на 100% метрично сумісні з Arial, Courier New та Times New Roman.

2. **Або покласти .ttf файли сюди в `frontend/public/fonts/`:**
   - `Arimo-Regular.ttf`
   - `Arimo-Bold.ttf`
   - `Arimo-Italic.ttf`
   - `Arimo-BoldItalic.ttf`
   - `Cousine-Bold.ttf`
   - `Tinos-Bold.ttf`
