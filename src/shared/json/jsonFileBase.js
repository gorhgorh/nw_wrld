import fs from "fs";
import path from "path";
import {
  atomicWriteFile,
  atomicWriteFileSync,
  cleanupStaleTempFiles,
} from "./atomicWrite.js";

const getJsonPath = (filename) => {
  const srcDir = path.join(__dirname, "..", "..");
  return path.join(srcDir, "shared", "json", filename);
};

const jsonDir = path.join(__dirname, "..", "..", "shared", "json");
cleanupStaleTempFiles(jsonDir);

export const loadJsonFile = async (filename, defaultValue, warningMsg) => {
  const filePath = getJsonPath(filename);
  try {
    const data = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (warningMsg) console.warn(warningMsg, error);

    try {
      const backupPath = `${filePath}.backup`;
      const backupData = await fs.promises.readFile(backupPath, "utf-8");
      console.warn(`Restored ${filename} from backup`);
      return JSON.parse(backupData);
    } catch (backupError) {
      return defaultValue;
    }
  }
};

export const loadJsonFileSync = (filename, defaultValue, errorMsg) => {
  const filePath = getJsonPath(filename);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (errorMsg) console.error(errorMsg, error);

    try {
      const backupPath = `${filePath}.backup`;
      const backupData = fs.readFileSync(backupPath, "utf-8");
      console.warn(`Restored ${filename} from backup`);
      return JSON.parse(backupData);
    } catch (backupError) {
      return defaultValue;
    }
  }
};

export const saveJsonFile = async (filename, data) => {
  const filePath = getJsonPath(filename);
  try {
    const dataString = JSON.stringify(data, null, 2);
    await atomicWriteFile(filePath, dataString);
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
  }
};

export const saveJsonFileSync = (filename, data) => {
  const filePath = getJsonPath(filename);
  try {
    const dataString = JSON.stringify(data, null, 2);
    atomicWriteFileSync(filePath, dataString);
  } catch (error) {
    console.error(`Error writing ${filename} (sync):`, error);
  }
};
