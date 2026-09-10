import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readEnv, updateEnv } from "./env.mjs";

const envFile = new URL("../.env", import.meta.url);
const exampleFile = new URL("../.env.example", import.meta.url);

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function secret(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return "";
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      resolve(value);
    };
    const onData = (character) => {
      if (character === "\u0003") {
        stdin.setRawMode(false);
        reject(new Error("Настройка отменена."));
      } else if (character === "\r" || character === "\n") finish();
      else if (character === "\u007f" || character === "\b") {
        if (value) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (character >= " ") {
        value += character;
        stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13))
  throw new Error("Нужен Node.js 22.13 или новее.");

if (!(await exists(envFile))) await copyFile(exampleFile, envFile);
const current = await readEnv(envFile);
const rl = createInterface({ input: stdin, output: stdout });

console.log("\nVideo Studio · первоначальная настройка\n");
const demoAnswer = await rl.question(
  `Режим без списаний для проверки? [${current.DEMO_MODE === "true" ? "Y/n" : "y/N"}]: `,
);
const demo = demoAnswer.trim()
  ? /^y(es)?$/i.test(demoAnswer.trim())
  : current.DEMO_MODE === "true";
rl.close();

let apiKey = current.OPENROUTER_API_KEY || "";
if (!demo && !apiKey) apiKey = await secret("Вставьте OpenRouter API key: ");
if (!demo && !apiKey)
  throw new Error(
    "Ключ не введён. Добавьте OPENROUTER_API_KEY в .env или включите DEMO_MODE=true.",
  );

await updateEnv(envFile, {
  DEMO_MODE: demo ? "true" : "false",
  OPENROUTER_API_KEY: apiKey,
});
console.log("\nНастройка сохранена локально в .env. Ключ не выводился и не отправлялся.");
console.log("Запуск: npm start");
console.log("Видеореференсы: npm run setup:worker\n");
