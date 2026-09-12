// 注册解析钩子。用法：node --import ./eval/register.mjs <file.ts>
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
