"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";

export function Slider({
  value,
  min = 0,
  max = 100,
  onValueChange,
  onValueCommit
}: {
  value: number[];
  min?: number;
  max?: number;
  onValueChange: (v: number[]) => void;
  onValueCommit?: (v: number[]) => void;
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      min={min}
      max={max}
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      className="relative flex w-full touch-none select-none items-center"
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary/90">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary bg-card shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/15" />
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary bg-card shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/15" />
    </SliderPrimitive.Root>
  );
}

