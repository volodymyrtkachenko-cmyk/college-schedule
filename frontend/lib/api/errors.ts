export class AuthSupersededError extends Error {
  constructor() {
    super("Auth operation superseded");
    this.name = "AuthSupersededError";
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FIELD_NAMES: Record<string, string> = {
  name: "Назва або ім’я",
  short_name: "Скорочення",
  email: "Електронна пошта",
  room: "Аудиторія",
  username: "Ім’я користувача",
  password: "Пароль",
  group_id: "Група",
  subject_id: "Предмет",
  teacher_id: "Викладач",
  lesson_number: "Номер пари",
};

const DETAIL_CODE_MESSAGES: Record<string, string> = {
  active_version_overlap: "Дати перетинаються з іншою активною версією.",
  clone_self: "Не можна клонувати версію в саму себе.",
  clone_target_not_empty:
    "Цільова версія вже містить заняття. Безпечний перезапис потребує окремого перегляду наслідків.",
  clone_source_empty: "Версія-джерело не містить занять.",
  version_delete_requires_data_policy:
    "Активну або заповнену версію не можна видалити без окремого захисту даних.",
  version_constraint_conflict: "Зміна суперечить обмеженням версій. Оновіть дані та повторіть перевірку.",
};

export async function parseApiError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (response.status >= 500) {
      return "Сталася помилка на сервері. Спробуйте ще раз пізніше.";
    }

    if (body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)) {
      return typeof body.detail.msg === "string"
        ? body.detail.msg
        : DETAIL_CODE_MESSAGES[body.detail.code] ?? "Операцію заблоковано через конфлікт даних.";
    }

    if (typeof body.detail === "string") {
      const raw = body.detail.toLowerCase();
      if (raw.includes("unique constraint failed")) {
        if (raw.includes("username")) return "Користувач із таким ім’ям уже існує.";
        if (raw.includes("name")) return "Такий запис уже існує (назва має бути унікальною).";
        return "Запис з такими даними вже існує.";
      }
      if (raw.includes("incorrect username")) return "Неправильний логін або пароль.";
      if (raw.includes("invalid or expired token") || raw.includes("сеанс завершився")) {
        return "Термін дії сеансу завершився. Увійдіть знову.";
      }
      if (raw.includes("draft not found")) return "Чернетку розкладу не знайдено.";
      if (raw.includes("not found") && raw.includes("version")) return "Версію розкладу не знайдено.";
      return body.detail;
    }

    if (body.detail && Array.isArray(body.detail)) {
      const err = body.detail[0];
      const rawField = String(err.loc?.slice(-1)[0] ?? "Поле");
      const field = FIELD_NAMES[rawField] ?? rawField;

      if (err.type.includes("missing")) return `Заповніть поле «${field}».`;
      if (err.type.includes("too_short")) return `Поле «${field}» не може бути порожнім.`;
      if (err.type.includes("string_pattern_mismatch")) return `Перевірте допустимі символи в полі «${field}».`;
      return `Перевірте правильність заповнення поля «${field}».`;
    }

    if (response.status >= 500) {
      return "Сталася помилка на сервері. Спробуйте ще раз пізніше.";
    }
    return body.detail ?? "Не вдалося виконати запит. Спробуйте ще раз.";
  } catch {
    return response.status >= 500
      ? "Сталася помилка на сервері. Спробуйте ще раз пізніше."
      : "Не вдалося виконати запит. Спробуйте ще раз.";
  }
}
