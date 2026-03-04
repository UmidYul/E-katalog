import { redirect } from "next/navigation";

const REDIRECT_TARGET = "/become-seller";

export default function ForShopsRedirectPage(): never {
  redirect(REDIRECT_TARGET);
}
