import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(150),
  password: z.string().min(8).max(128)
});

export const registerSchema = z
  .object({
    email: z.string().email().max(150),
    fullName: z.string().min(2).max(120),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128)
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;

