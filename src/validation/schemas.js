const { z } = require('zod');
const { OBJECT_TYPES, ROLES, STUDY_LEVELS, STUDY_MODES, DISABILITIES } = require('../domain/constants');

z.config(z.locales.pl());

const text = (label, { max = 200, min = 1 } = {}) =>
  z.string({ error: `${label}: wartość jest wymagana` }).trim()
    .min(min, `${label}: wartość jest wymagana`)
    .max(max, `${label}: maksymalnie ${max} znaków`);

const optionalText = (max = 2000) =>
  z.string().trim().max(max, `Maksymalnie ${max} znaków`).optional().transform((v) => (v ? v : null));

const idOrNull = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.coerce.number().int().positive().nullable(),
);
const requiredId = (label) => z.coerce.number({ error: `${label}: wybierz wartość` }).int().positive(`${label}: wybierz wartość`);
const checkbox = z.preprocess((v) => v === 'on' || v === '1' || v === 'true' || v === true, z.boolean());

const objectSchema = z.object({
  name: text('Nazwa'),
  type: z.enum(Object.keys(OBJECT_TYPES), { error: 'Typ obiektu: wybierz wartość' }),
  parentId: idOrNull,
  address: optionalText(300),
  coordinatorId: idOrNull,
  notes: optionalText(2000),
});

const criterionSchema = z.object({
  code: text('Kod', { max: 30 }).regex(/^[A-Za-z0-9._-]+$/, 'Kod: dozwolone litery, cyfry, kropka, myślnik'),
  area: z.enum(['OZN', 'KSZTALCENIE'], { error: 'Obszar: wybierz wartość' }),
  category: text('Kategoria', { max: 100 }),
  text: text('Treść kryterium', { max: 500 }),
  hint: optionalText(1000),
  weight: z.coerce.number({ error: 'Waga: podaj liczbę 1–5' }).int().min(1, 'Waga: 1–5').max(5, 'Waga: 1–5'),
  answerType: z.enum(['scale', 'ternary'], { error: 'Typ oceny: wybierz wartość' }),
  position: z.preprocess((v) => (v === '' ? 0 : v), z.coerce.number().int().min(0).max(9999)).default(0),
  active: checkbox,
});

const scenarioSchema = z.object({
  title: text('Tytuł', { max: 150 }),
  description: optionalText(3000),
  areas: z.enum(['OZN', 'KSZTALCENIE', 'BOTH'], { error: 'Zakres: wybierz wartość' }),
  active: checkbox,
});

const auditCreateSchema = z.object({
  objectId: requiredId('Obiekt'),
  auditorId: requiredId('Audytor'),
  scenarioId: requiredId('Scenariusz'),
  dueDate: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Termin: podaj datę w formacie RRRR-MM-DD').optional(),
  ).transform((v) => v ?? null),
});

const answersSchema = z.object({
  generalNotes: optionalText(5000),
  answers: z.record(
    z.string().regex(/^\d+$/),
    z.object({
      answer: z.string().max(20).optional(),
      comment: z.string().trim().max(2000, 'Komentarz: maksymalnie 2000 znaków').optional(),
    }),
  ).default({}),
});

const reviewSchema = z.object({ comment: optionalText(2000) });
const returnSchema = z.object({ comment: text('Uzasadnienie zwrotu', { max: 2000 }) });

const userUpdateSchema = z.object({
  role: z.enum(Object.values(ROLES), { error: 'Rola: wybierz wartość' }),
  active: checkbox,
});

const officeReviewSchema = z.object({
  objectId: requiredId('Uczelnia'),
  programme: text('Kierunek', { max: 150, min: 2 }),
  studyLevel: z.enum(Object.keys(STUDY_LEVELS), { error: 'Poziom studiów: wybierz wartość' }),
  studyMode: z.enum(Object.keys(STUDY_MODES), { error: 'Tryb studiów: wybierz wartość' }),
  disability: z.enum(Object.keys(DISABILITIES), { error: 'Rodzaj niepełnosprawności: wybierz wartość' }),
});

const officeDetailsSchema = z.object({
  contactNotes: optionalText(3000),
  generalNotes: optionalText(5000),
  answers: answersSchema.shape.answers,
});

const officeQuestionSchema = criterionSchema.omit({ area: true });

const idParam = z.coerce.number().int().positive();

/** Zwraca { ok, data, errors } gdzie errors to mapa pole → komunikat (pierwszy błąd pola). */
function parseForm(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return { ok: true, data: result.data, errors: {} };
  const errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_form';
    errors[key] ??= issue.message;
  }
  return { ok: false, data: null, errors };
}

module.exports = {
  objectSchema, criterionSchema, scenarioSchema, auditCreateSchema, answersSchema,
  reviewSchema, returnSchema, userUpdateSchema, officeReviewSchema, officeDetailsSchema, officeQuestionSchema, idParam, parseForm,
};
