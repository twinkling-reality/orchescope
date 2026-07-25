/**
 * A minimal protobuf wire format reader.
 *
 * The OpenTelemetry JavaScript SDK exports `application/x-protobuf` by default, verified against a
 * local receiver, so a receiver that only accepted JSON would require every user to change an
 * environment variable before their existing instrumentation reached Orchescope. Rather than depend on
 * a code generator and a schema compiler for one message family, this reads the wire format directly
 * and the OTLP shapes are decoded in `otlp.ts`.
 *
 * Only what OTLP needs is implemented: varint, 64 bit fixed, 32 bit fixed and length delimited fields.
 * Groups, the deprecated wire type 3 and 4, are rejected. Unknown fields are skipped, which is what the
 * protobuf specification requires of any reader.
 */

export type WireType = 0 | 1 | 2 | 5;

export type FieldValue =
  | { readonly wire: 0; readonly value: bigint }
  | { readonly wire: 1; readonly value: bigint }
  | { readonly wire: 5; readonly value: number }
  | { readonly wire: 2; readonly value: Uint8Array };

export class ProtobufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtobufError';
  }
}

const MAX_VARINT_BYTES = 10;

export class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  get position(): number {
    return this.offset;
  }

  private readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
      if (this.offset >= this.bytes.length) {
        throw new ProtobufError('truncated varint');
      }
      const byte = this.bytes[this.offset] as number;
      this.offset += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new ProtobufError('varint longer than ten bytes');
  }

  private readFixed(size: 4 | 8): { readonly u32: number; readonly u64: bigint } {
    if (this.offset + size > this.bytes.length) {
      throw new ProtobufError(`truncated ${size} byte fixed field`);
    }
    let value = 0n;
    for (let index = size - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(this.bytes[this.offset + index] as number);
    }
    this.offset += size;
    return { u32: Number(value & 0xffffffffn), u64: value };
  }

  private readBytes(): Uint8Array {
    const length = Number(this.readVarint());
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new ProtobufError('length delimited field exceeds the buffer');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  /** Reads the next field. Returns undefined at the end of the buffer. */
  next(): { readonly field: number; readonly value: FieldValue } | undefined {
    if (this.done) return undefined;
    const tag = this.readVarint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 0x7n);
    if (field === 0) throw new ProtobufError('field number zero is not valid');
    switch (wire) {
      case 0:
        return { field, value: { wire: 0, value: this.readVarint() } };
      case 1:
        return { field, value: { wire: 1, value: this.readFixed(8).u64 } };
      case 2:
        return { field, value: { wire: 2, value: this.readBytes() } };
      case 5:
        return { field, value: { wire: 5, value: this.readFixed(4).u32 } };
      default:
        throw new ProtobufError(`unsupported wire type ${wire}`);
    }
  }
}

export const decodeUtf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Decodes a double from its little endian bit pattern. */
export const decodeDouble = (bits: bigint): number => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(bits);
  return buffer.readDoubleLE(0);
};

export const asNumber = (value: FieldValue): number =>
  value.wire === 5 ? value.value : Number(value.value);

export const asBigInt = (value: FieldValue): bigint =>
  value.wire === 5 ? BigInt(value.value) : value.wire === 2 ? 0n : value.value;

export const asBytes = (value: FieldValue): Uint8Array =>
  value.wire === 2 ? value.value : new Uint8Array();

export const asString = (value: FieldValue): string =>
  value.wire === 2 ? decodeUtf8(value.value) : '';

/** Iterates the fields of a nested message. */
export const eachField = (
  bytes: Uint8Array,
  visit: (field: number, value: FieldValue) => void,
): void => {
  const reader = new Reader(bytes);
  for (;;) {
    const entry = reader.next();
    if (entry === undefined) return;
    visit(entry.field, entry.value);
  }
};
