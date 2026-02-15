import type { ApiMethods } from "@grammyjs/types";

type BotApi = ApiMethods<unknown>;

type MethodArgs<M extends keyof BotApi> = BotApi[M] extends (
  args: infer A,
) => unknown
  ? NonNullable<A>
  : {};

export type BotApiMethodNames = keyof BotApi;
export type BotApiMethodInputMap = {
  [M in keyof BotApi]: MethodArgs<M>;
};
