const fs = require("fs");

// Import translations
const { translations } = require("./translations.ts");

// Function to compare translation keys
const findMissingKeys = (source, target, path = "") => {
  let missingKeys = [];

  for (const key in source) {
    if (!target.hasOwnProperty(key)) {
      missingKeys.push(`${path}${key}`);
    } else if (typeof source[key] === "object" && typeof target[key] === "object") {
      missingKeys = missingKeys.concat(findMissingKeys(source[key], target[key], `${path}${key}.`));
    }
  }

  return missingKeys;
};

// Compare English to Polish and vice versa
const missingInPl = findMissingKeys(translations.en, translations.pl);
const missingInEn = findMissingKeys(translations.pl, translations.en);

if (missingInPl.length > 0) {
  console.log("❌ Missing keys in Polish:");
  console.log(missingInPl.join("\n"));
} else {
  console.log("✅ Polish translations are complete!");
}

if (missingInEn.length > 0) {
  console.log("\n❌ Missing keys in English:");
  console.log(missingInEn.join("\n"));
} else {
  console.log("\n✅ English translations are complete!");
}

