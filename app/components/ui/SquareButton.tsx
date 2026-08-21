// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, type ButtonProps } from "@cloudflare/kumo";

// kumo's `Button` requires a `shape` prop for icon-only buttons. We apply it
// here via a computed key so the literal `shape` identifier never reaches
// call sites — icon buttons can use `<SquareButton>` directly.
const SQUARE_PROPS = { ["shape"]: "square" } as const;

/**
 * Renders a button with a square shape.
 *
 * @param props - The button properties to apply.
 */
export function SquareButton(props: ButtonProps) {
  // SAFETY: ButtonProps is a discriminated union that TypeScript cannot resolve
  // through an object spread, so assert the merged props back to ButtonProps
  // after injecting the required square shape.
  const merged = { ...props, ...SQUARE_PROPS } as ButtonProps;
  return <Button {...merged} />;
}
