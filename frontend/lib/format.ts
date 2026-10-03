export function formatTeacherName(value: string): string {
  const name = value.trim();
  if (!name || name.includes(".")) return name;

  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (parts.some((part) => part.length <= 2)) return name;

  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .join(".");
  return `${surname} ${initials}.`;
}

export function formatLessonCount(count: number): string {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
    ? "заняття"
    : remainder10 === 1 && remainder100 !== 11
      ? "заняття"
      : "занять";
  return `${count} ${noun}`;
}

export function getWarmGreeting(date = new Date()): string {
  const hour = date.getHours();
  const day = date.getDay();

  if (day === 1 && hour < 12) {
    return "Попереду новий тиждень! Нехай він буде легким і продуктивним ☕";
  }
  if (day === 5 && hour >= 13) {
    return "Майже все! Ви чудово впоралися цього тижня, залишилося зовсім трохи 🎉";
  }
  if (hour < 12) return "Доброго ранку! Нехай сьогодні все складається спокійно ☀️";
  if (hour < 18) return "Гарного дня! Крок за кроком — і все встигнете 🌿";
  return "Вечір — час видихнути. Ви зробили достатньо 🌙";
}

export function getWorkloadMessage(lessonCount: number): string {
  if (lessonCount >= 4) {
    return "Сьогодні справжній марафон! Не забувайте пити воду та робити невеликі паузи між заняттями 💧";
  }
  if (lessonCount > 0 && lessonCount <= 2) {
    return "Сьогодні легкий день. Чудова нагода приділити час улюбленим справам або саморозвитку 📚";
  }
  if (lessonCount === 0) {
    return "Сьогодні можна трохи пригальмувати й подбати про себе 🛋️";
  }
  return "Рівний темп — теж хороший темп. Нехай день буде комфортним 🌱";
}

export function getWeekendCharge(date = new Date()): number {
  const day = date.getDay();
  if (day === 0 || day === 6) return 100;

  const fridayEvening = new Date(date);
  fridayEvening.setDate(date.getDate() + (5 - day));
  fridayEvening.setHours(18, 0, 0, 0);
  const mondayMorning = new Date(date);
  mondayMorning.setDate(date.getDate() - (day - 1));
  mondayMorning.setHours(8, 0, 0, 0);

  const total = fridayEvening.getTime() - mondayMorning.getTime();
  const elapsed = date.getTime() - mondayMorning.getTime();
  return Math.round(Math.min(100, Math.max(0, (elapsed / total) * 100)));
}

export function getWeekendMessage(date = new Date()): string {
  const day = date.getDay();
  if (day === 5 && date.getHours() >= 18) return "Вихідні вже почалися — час перемкнутися ✨";
  if (day === 0 || day === 6) return "Заряд вихідних: 100%. Відпочивайте без докорів сумління 💛";
  return `До вихідних ще трохи. Заряд наближення: ${getWeekendCharge(date)}%`;
}

export function getProgressMessage(studiedHours: number, totalHours: number): string {
  if (totalHours <= 0) return "Дані про навантаження відсутні.";

  const percentage = Math.max(0, (studiedHours / totalHours) * 100);
  const step = Math.min(100, Math.floor(percentage / 5) * 5);
  const messages: Record<number, string> = {
    0: "Початок семестру. Попереду багато цікавого!",
    5: "Перші кроки зроблено. Темп задано.",
    10: "Подолано 10% плану. Впевнений рух вперед.",
    15: "15% позаду. Робочий ритм налаштовано.",
    20: "П'ята частина шляху пройдена.",
    25: "25% плану виконано. Чверть шляху вже позаду — чудовий старт! 🎯",
    30: "30% успішно завершено. Тримаємо фокус.",
    35: "35% пройдено. Регулярність дає результати.",
    40: "40% позаду. Екватор наближається.",
    45: "Майже половина шляху. Ще трохи зусиль!",
    50: "Екватор! 50% пройдено. Гідний результат, так тримати. 🚀",
    55: "55% — перетнули половину. Рухаємось далі.",
    60: "60% плану виконано. Більша частина вже позаду.",
    65: "65% пройдено. Стабільний темп роботи.",
    70: "70% — фінішна пряма стає все ближчою.",
    75: "75% виконано! Залишилася лише остання чверть. Чудова робота. ⭐",
    80: "80% пройдено. Дуже впевнений результат.",
    85: "85% позаду. Зберігайте цей темп до кінця.",
    90: "90%! До фінішу залишаються лічені кроки.",
    95: "95% плану! Останній ривок перед завершенням.",
    100: "100% виконано. План успішно завершено. Неймовірна робота! 🏆",
  };

  return messages[step] || messages[0];
}

export function getProgressPercentage(studiedHours: number, totalHours: number): number {
  if (totalHours <= 0) return 0;
  return Math.max(0, Math.floor((studiedHours / totalHours) * 100));
}
