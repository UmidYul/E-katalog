import { z } from "zod";

const phoneRegex = /^(?:\+?998)?\d{9}$/;

const contactSchema = z
  .string()
  .min(3)
  .max(150)
  .transform((value) => value.trim())
  .refine((value) => z.string().email().safeParse(value).success || phoneRegex.test(value), {
    message: "Email ёки +998XXXXXXXXX форматини киритинг",
  });

export const loginSchema = z.object({
  identifier: contactSchema,
  password: z.string().min(0).max(128),
  otp: z.string().min(0).max(8).optional(),
  rememberMe: z.boolean().default(true),
});

export const registerSchema = z.object({
  contact: contactSchema,
  password: z.string().min(8).max(128),
  otp: z.string().min(0).max(8).optional(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
