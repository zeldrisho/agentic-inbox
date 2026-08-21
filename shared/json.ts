// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Concrete representation of JSON values.
 *
 * Use this instead of `unknown` wherever an API contract would otherwise
 * demand an unchecked escape hatch, so callers receive a real value contract
 * rather than `unknown`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** JSON object with arbitrary string keys and `JsonValue` members. */
export type JsonObject = { [key: string]: JsonValue };
