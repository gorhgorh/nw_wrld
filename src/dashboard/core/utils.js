import fs from "fs";
import path from "path";
import { produce } from "immer";
import { migrateToSets, getActiveSet } from "../../shared/utils/setUtils.js";
import { DEFAULT_GLOBAL_MAPPINGS } from "../../shared/config/defaultConfig.js";
import {
  atomicWriteFile,
  atomicWriteFileSync,
} from "../../shared/json/atomicWrite.js";

const getMethodsByLayer = (module, moduleBase, threeBase) => {
  if (!module || !module.methods) return [];

  const layers = [];
  const allModuleMethods = module.methods.map((m) => m.name);

  const baseMethodsInModule = allModuleMethods.filter((name) =>
    moduleBase.includes(name)
  );
  if (baseMethodsInModule.length > 0) {
    layers.push({
      name: "Base",
      methods: baseMethodsInModule,
    });
  }

  const threeBaseMethodsOnly = threeBase.filter(
    (name) => !moduleBase.includes(name)
  );
  const threeMethodsInModule = allModuleMethods.filter((name) =>
    threeBaseMethodsOnly.includes(name)
  );
  if (threeMethodsInModule.length > 0) {
    layers.push({
      name: "Three.js Base",
      methods: threeMethodsInModule,
    });
  }

  const allBaseMethods = [...moduleBase, ...threeBase];
  const moduleMethods = allModuleMethods.filter(
    (name) => !allBaseMethods.includes(name)
  );
  if (moduleMethods.length > 0) {
    layers.push({
      name: module.name,
      methods: moduleMethods,
    });
  }

  return layers;
};

const getMethodCode = (moduleName, methodName) => {
  try {
    const srcDir = path.join(__dirname, "..", "..");
    const moduleBasePath = path.join(
      srcDir,
      "projector",
      "helpers",
      "moduleBase.js"
    );
    const threeBasePath = path.join(
      srcDir,
      "projector",
      "helpers",
      "threeBase.js"
    );
    const modulePath = path.join(
      srcDir,
      "projector",
      "modules",
      `${moduleName}.js`
    );

    let filePath = null;
    let fileContent = null;
    let searchOrder = [];

    if (fs.existsSync(modulePath)) {
      searchOrder.push({ path: modulePath, name: "module" });
    }
    if (fs.existsSync(moduleBasePath)) {
      searchOrder.push({ path: moduleBasePath, name: "moduleBase" });
    }
    if (fs.existsSync(threeBasePath)) {
      searchOrder.push({ path: threeBasePath, name: "threeBase" });
    }

    for (const fileInfo of searchOrder) {
      const content = fs.readFileSync(fileInfo.path, "utf-8");
      const classMethodRegex = new RegExp(
        `\\s+${methodName}\\s*\\([^)]*\\)\\s*\\{`,
        "m"
      );

      if (classMethodRegex.test(content)) {
        filePath = fileInfo.path;
        fileContent = content;
        break;
      }
    }

    if (!fileContent || !filePath) {
      return { code: null, filePath: null };
    }

    const methodNamePattern = new RegExp(`\\s+${methodName}\\s*\\(`, "m");
    const methodNameMatch = fileContent.match(methodNamePattern);

    if (methodNameMatch) {
      const startIndex = fileContent.indexOf(methodNameMatch[0]);
      if (startIndex !== -1) {
        let parenCount = 0;
        let braceCount = 0;
        let inString = false;
        let stringChar = null;
        let foundMethodBody = false;
        let i = startIndex + methodNameMatch[0].indexOf("(");

        while (i < fileContent.length) {
          const char = fileContent[i];
          const prevChar = i > 0 ? fileContent[i - 1] : null;

          if (!inString && (char === '"' || char === "'" || char === "`")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && prevChar !== "\\") {
            inString = false;
            stringChar = null;
          } else if (!inString) {
            if (char === "(") parenCount++;
            if (char === ")") parenCount--;
            if (char === "{") {
              if (parenCount === 0 && !foundMethodBody) {
                foundMethodBody = true;
                braceCount = 1;
              } else {
                braceCount++;
              }
            }
            if (char === "}") {
              braceCount--;
              if (foundMethodBody && braceCount === 0) {
                const code = fileContent.substring(startIndex, i + 1);
                return {
                  code: code.trim(),
                  filePath: filePath.replace(srcDir, "src"),
                };
              }
            }
          }
          i++;
        }
      }
    }

    return { code: null, filePath: filePath.replace(srcDir, "src") };
  } catch (error) {
    console.error("Error extracting method code:", error);
    return { code: null, filePath: null };
  }
};

const updateUserData = (setUserData, updater) => {
  setUserData((prev) =>
    produce(prev, (draft) => {
      updater(draft);
    })
  );
};

const getUserDataPath = () => {
  const srcDir = path.join(__dirname, "..", "..");
  const userDataPath = path.join(srcDir, "shared", "json", "userData.json");
  return userDataPath;
};

const loadUserData = async () => {
  const filePath = getUserDataPath();
  try {
    const data = await fs.promises.readFile(filePath, "utf-8");
    const parsedData = JSON.parse(data);

    const migratedData = migrateToSets(parsedData);

    if (!migratedData.config) {
      migratedData.config = {};
    }
    if (!Array.isArray(migratedData.sets)) {
      migratedData.sets = [];
    }

    if (!migratedData.config.trackMappings) {
      migratedData.config.trackMappings = DEFAULT_GLOBAL_MAPPINGS.trackMappings;
    }
    if (!migratedData.config.channelMappings) {
      migratedData.config.channelMappings =
        DEFAULT_GLOBAL_MAPPINGS.channelMappings;
    }

    migratedData._loadedSuccessfully = true;
    return migratedData;
  } catch (error) {
    console.warn("Could not load userData.json, trying backup...", error);

    try {
      const backupPath = `${filePath}.backup`;
      const backupData = await fs.promises.readFile(backupPath, "utf-8");
      const parsedData = JSON.parse(backupData);
      const migratedData = migrateToSets(parsedData);

      if (!migratedData.config) {
        migratedData.config = {};
      }
      if (!Array.isArray(migratedData.sets)) {
        migratedData.sets = [];
      }

      if (!migratedData.config.trackMappings) {
        migratedData.config.trackMappings =
          DEFAULT_GLOBAL_MAPPINGS.trackMappings;
      }
      if (!migratedData.config.channelMappings) {
        migratedData.config.channelMappings =
          DEFAULT_GLOBAL_MAPPINGS.channelMappings;
      }

      migratedData._loadedSuccessfully = true;
      console.warn("Restored from backup");
      return migratedData;
    } catch (backupError) {
      console.warn(
        "Backup also failed, initializing with empty data.",
        backupError
      );
    }

    const defaultData = {
      config: {
        activeSetId: null,
        trackMappings: DEFAULT_GLOBAL_MAPPINGS.trackMappings,
        channelMappings: DEFAULT_GLOBAL_MAPPINGS.channelMappings,
      },
      sets: [],
      _isDefaultData: true,
    };
    return defaultData;
  }
};

const saveUserData = async (data) => {
  if (data?._isDefaultData) {
    console.warn(
      "Skipping save: data is default empty data returned from loadUserData error. Not overwriting file."
    );
    return;
  }
  if (Array.isArray(data?.sets) && data.sets.length === 0) {
    console.warn(
      "Skipping save: data has empty sets array. Not overwriting file with empty data."
    );
    return;
  }
  const filePath = getUserDataPath();
  try {
    const dataToSave = { ...data };
    delete dataToSave._isDefaultData;
    delete dataToSave._loadedSuccessfully;
    const dataString = JSON.stringify(dataToSave, null, 2);
    await atomicWriteFile(filePath, dataString);
  } catch (error) {
    console.error("Error writing userData to JSON file:", error);
  }
};

const saveUserDataSync = (data) => {
  if (data?._isDefaultData) {
    console.warn(
      "Skipping save (sync): data is default empty data returned from loadUserData error. Not overwriting file."
    );
    return;
  }
  if (Array.isArray(data?.sets) && data.sets.length === 0) {
    console.warn(
      "Skipping save (sync): data has empty sets array. Not overwriting file with empty data."
    );
    return;
  }
  const filePath = getUserDataPath();
  try {
    const dataToSave = { ...data };
    delete dataToSave._isDefaultData;
    delete dataToSave._loadedSuccessfully;
    const dataString = JSON.stringify(dataToSave, null, 2);
    atomicWriteFileSync(filePath, dataString);
  } catch (error) {
    console.error("Error writing userData to JSON file (sync):", error);
  }
};

const generateTrackNotes = () => {
  const channelNotes = [
    "G8",
    "F#8",
    "F8",
    "E8",
    "D#8",
    "D8",
    "C#8",
    "C8",
    "B7",
    "A#7",
    "A7",
    "G#7",
    "G7",
    "F#7",
    "F7",
    "E7",
  ];

  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octaves = [-1, 0, 1, 2];
  const standardNotes = [];
  octaves.forEach((oct) => {
    noteNames.forEach((n) => standardNotes.push(`${n}${oct}`));
  });

  return [...channelNotes, ...standardNotes];
};

const updateActiveSet = (setUserData, activeSetId, updater) => {
  updateUserData(setUserData, (draft) => {
    const activeSet = getActiveSet(draft, activeSetId);
    if (!activeSet) return;
    updater(activeSet, draft);
  });
};

export {
  getMethodsByLayer,
  getMethodCode,
  updateUserData,
  getUserDataPath,
  loadUserData,
  saveUserData,
  saveUserDataSync,
  generateTrackNotes,
  updateActiveSet,
};
