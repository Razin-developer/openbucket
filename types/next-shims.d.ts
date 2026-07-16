declare module "next" {
  export type Metadata = Record<string, unknown>;
  export type NextConfig = Record<string, unknown>;
}

declare module "next/headers" {
  export function headers(): Promise<Headers>;
}

declare module "next/font/google" {
  type FontOptions = {
    variable?: string;
    subsets?: string[];
    display?: string;
    weight?: string | string[];
  };

  type FontResult = {
    className: string;
    style: { fontFamily: string };
    variable: string;
  };

  export function Geist(options?: FontOptions): FontResult;
  export function Geist_Mono(options?: FontOptions): FontResult;
}
