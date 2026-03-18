"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";

import { useLocale } from "@/components/common/locale-provider";
import { cn } from "@/lib/utils/cn";

interface StarRatingProps {
    value: number;
    max?: number;
    onChange?: (value: number) => void;
    readonly?: boolean;
    size?: "sm" | "md" | "lg";
    className?: string;
}

const sizeMap = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
};

export function StarRating({ value, max = 5, onChange, readonly = false, size = "md", className }: StarRatingProps) {
    const { locale } = useLocale();
    const ratingLabel = locale === "uz-Cyrl-UZ" ? `Рейтинг: ${value} / ${max}` : `Рейтинг: ${value} из ${max}`;
    const starLabel = (index: number) => (locale === "uz-Cyrl-UZ" ? `${index} юлдуз` : `${index} звезда`);

    return (
        <div
            className={cn("inline-flex items-center gap-0.5", className)}
            role={readonly ? "img" : "group"}
            aria-label={ratingLabel}
        >
            {Array.from({ length: max }, (_, i) => {
                const filled = i < Math.floor(value);
                const half = !filled && i < value;
                return (
                    <motion.button
                        key={i}
                        type="button"
                        disabled={readonly}
                        onClick={() => onChange?.(i + 1)}
                        whileHover={readonly ? {} : { scale: 1.2 }}
                        whileTap={readonly ? {} : { scale: 0.9 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                            "relative transition-colors",
                            readonly ? "cursor-default" : "cursor-pointer"
                        )}
                        aria-label={starLabel(i + 1)}
                    >
                        <Star
                            className={cn(
                                sizeMap[size],
                                filled ? "fill-amber-400 text-amber-400" : half ? "fill-amber-200 text-amber-400" : "fill-transparent text-border"
                            )}
                        />
                    </motion.button>
                );
            })}
        </div>
    );
}
