/* // index.ts
// Usage:
//   ts-node src/index.ts <file.php>                   → pretty grouped output
//   ts-node src/index.ts <file.php> --json            → full JSON output
//   ts-node src/index.ts <file.php> --json > out.json
//   ts-node src/index.ts <file.php> --symbol <name>   → show symbol details
//   ts-node src/index.ts <file.php> --ast <expr>      → parse specific expression

import * as path from "path";
import * as fs from "fs";
import {
  PHPSymbolTableBuilder,
  SymbolTable,
  ClassSymbol,
  MethodSymbol,
  PropertySymbol,
  ConstantSymbol,
  FunctionSymbol,
  ClosureSymbol,
  Symbol,
} from "./parser/PHPSymbolTable";
import { PHPExpressionParser } from "./parser/PHPExpressionParser";

const args = process.argv.slice(2);
const phpFile = args.find((a) => !a.startsWith("--"));
const jsonMode = args.includes("--json");
const astMode = args.includes("--ast");
const astTarget = (() => {
  const idx = args.indexOf("--ast");
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")
    ? args[idx + 1]
    : null;
})();
const symbolMode = args.includes("--symbol");
const symbolTarget = (() => {
  const idx = args.indexOf("--symbol");
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")
    ? args[idx + 1]
    : null;
})();

if (!phpFile) {
  console.error(
    [
      "Usage: ts-node src/index.ts <file.php> [options]",
      "  --json                  Full JSON output (complete symbol table)",
      "  --ast <expr>            Parse and show AST for specific expression",
      "  --symbol <name>         Show details for a specific symbol",
      "",
      "Examples:",
      "  ts-node src/index.ts test.php --json > analysis.json",
      "  ts-node src/index.ts test.php --symbol UserRepository",
      "  ts-node src/index.ts test.php --ast '$user->getName()'",
    ].join("\n"),
  );
  process.exit(1);
}

const filePath = path.resolve(phpFile);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// Build symbol table (single source of truth)
console.error("Building symbol table...");
const symbolBuilder = new PHPSymbolTableBuilder();
const symbolTable = symbolBuilder.buildFromFile(filePath);
console.error("Done.\n");

const expressionParser = new PHPExpressionParser();

// ── --json: Complete symbol table output ─────────────────────────────────────
if (jsonMode) {
  const output = symbolBuilder.exportToJSON(symbolTable);
  console.log(output);
  process.exit(0);
}

// ── --symbol (symbol details) ─────────────────────────────────────────────────
if (symbolMode) {
  if (!symbolTarget) {
    console.error("Please provide a symbol name: --symbol <name>");
    process.exit(1);
  }

  const symbol = symbolTable.byName.get(symbolTarget);
  if (!symbol) {
    console.error(`Symbol "${symbolTarget}" not found.`);
    console.error(`\nAvailable symbols (first 20):`);
    const symbols = Array.from(symbolTable.byName.keys()).slice(0, 20);
    for (const s of symbols) {
      console.error(`  - ${s}`);
    }
    process.exit(1);
  }

  console.log("\n" + "═".repeat(80));
  console.log(`  SYMBOL DETAILS: ${symbol.name}`);
  console.log("═".repeat(80));

  console.log(`\n  📋 Basic Info:`);
  console.log(`     Kind:              ${symbol.kind}`);
  console.log(`     FQN:               ${symbol.fullyQualifiedName}`);
  console.log(
    `     Location:          ${symbol.location.filePath}:${symbol.location.line}–${symbol.location.endLine}`,
  );
  console.log(`     Visibility:        ${symbol.visibility || "public"}`);
  console.log(`     Static:            ${symbol.isStatic ? "yes" : "no"}`);
  console.log(`     Abstract:          ${symbol.isAbstract ? "yes" : "no"}`);
  console.log(`     Final:             ${symbol.isFinal ? "yes" : "no"}`);

  // Class-specific
  if (symbol.kind === "class") {
    const cls = symbol as ClassSymbol;
    console.log(`\n  🏗️ Class Info:`);
    console.log(`     Namespace:         ${cls.namespace}`);
    console.log(`     Extends:           ${cls.extends || "(none)"}`);
    if (cls.implements.length) {
      console.log(`     Implements:        ${cls.implements.join(", ")}`);
    }
    if (cls.uses.length) {
      console.log(`     Uses Traits:       ${cls.uses.join(", ")}`);
    }
    console.log(`     Methods:           ${cls.methods.size}`);
    console.log(`     Properties:        ${cls.properties.size}`);
    console.log(`     Constants:         ${cls.constants.size}`);

    // Show methods
    if (cls.methods.size > 0) {
      console.log(`\n  🔧 Methods:`);
      for (const [name, method] of cls.methods) {
        const params = method.parameters.map((p) => p.name).join(", ");
        const returnType = method.returnType ? `: ${method.returnType}` : "";
        const mods = [];
        if (method.visibility) mods.push(method.visibility);
        if (method.isStatic) mods.push("static");
        if (method.isAbstract) mods.push("abstract");
        if (method.isFinal) mods.push("final");

        console.log(`     ${mods.join(" ")} ${name}(${params})${returnType}`);
      }
    }

    // Show properties
    if (cls.properties.size > 0) {
      console.log(`\n  📦 Properties:`);
      for (const [name, prop] of cls.properties) {
        const typeStr = prop.type ? `: ${prop.type}` : "";
        const defaultStr = prop.defaultValue
          ? ` = ${prop.defaultValue.raw || "..."}`
          : "";
        const mods = [];
        if (prop.visibility) mods.push(prop.visibility);
        if (prop.isStatic) mods.push("static");
        if (prop.isReadonly) mods.push("readonly");

        console.log(`     ${mods.join(" ")} ${name}${typeStr}${defaultStr}`);
      }
    }

    // Show constants
    if (cls.constants.size > 0) {
      console.log(`\n  📌 Constants:`);
      for (const [name, const_] of cls.constants) {
        const vis = const_.visibility ? `${const_.visibility} ` : "";
        console.log(`     ${vis}${name} = ${const_.value}`);
      }
    }
  }

  // Function-specific
  if (symbol.kind === "function") {
    const func = symbol as FunctionSymbol;
    console.log(`\n  🔧 Function Info:`);
    console.log(`     Namespace:         ${func.namespace || "(global)"}`);
    const params = func.parameters.map((p) => p.name).join(", ");
    const returnType = func.returnType ? `: ${func.returnType}` : "";
    console.log(`     Signature:         ${func.name}(${params})${returnType}`);
  }

  // Method-specific
  if (symbol.kind === "method") {
    const method = symbol as MethodSymbol;
    console.log(`\n  🔧 Method Info:`);
    const params = method.parameters.map((p) => p.name).join(", ");
    const returnType = method.returnType ? `: ${method.returnType}` : "";
    console.log(
      `     Signature:         ${method.name}(${params})${returnType}`,
    );
    if (method.isConstructor) console.log(`     🏗️  Constructor`);
    if (method.isDestructor) console.log(`     💀  Destructor`);
    if (method.isMagicMethod) console.log(`     ✨  Magic Method`);
  }

  // Closure-specific
  if (symbol.kind === "closure") {
    const closure = symbol as ClosureSymbol;
    console.log(`\n  🔐 Closure Info:`);
    console.log(
      `     Assigned To:       ${closure.assignedTo || "(anonymous)"}`,
    );
    console.log(
      `     Parent Context:    ${closure.parentContext || "(global)"}`,
    );
    console.log(`     Arrow Function:    ${closure.isArrow ? "yes" : "no"}`);
    const params = closure.parameters.map((p) => p.name).join(", ");
    const returnType = closure.returnType ? `: ${closure.returnType}` : "";
    console.log(
      `     Signature:         ${closure.assignedTo || ""}(${params})${returnType}`,
    );
  }

  // References
  if (symbol.references.length > 0) {
    console.log(`\n  🔗 References (${symbol.references.length}):`);
    for (const ref of symbol.references.slice(0, 10)) {
      console.log(
        `     ${ref.context} (${path.basename(ref.location.filePath)}:${ref.location.line})`,
      );
    }
    if (symbol.references.length > 10) {
      console.log(`     ... and ${symbol.references.length - 10} more`);
    }
  }

  console.log("\n" + "═".repeat(80));
  process.exit(0);
}

// ── --ast (expression AST) ────────────────────────────────────────────────────
if (astMode) {
  if (astTarget) {
    console.log("\n" + "═".repeat(80));
    console.log(`  AST FOR EXPRESSION: ${astTarget}`);
    console.log("═".repeat(80));
    try {
      const ast = expressionParser.parse(astTarget);
      console.log(JSON.stringify(ast, null, 2));
    } catch (error: any) {
      console.error(`\n❌ Parse error: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log("\n" + "═".repeat(80));
    console.log(`  AVAILABLE EXPRESSIONS IN ${path.basename(filePath)}`);
    console.log("═".repeat(80));

    const expressions: { name: string; value: string; line: number }[] = [];

    for (const [name, symbol] of symbolTable.byName) {
      if (symbol.kind === "property") {
        const prop = symbol as PropertySymbol;
        if (prop.defaultValue) {
          expressions.push({
            name: `${prop.fullyQualifiedName}`,
            value: prop.defaultValue.raw || "?",
            line: prop.location.line,
          });
        }
      }
      if (symbol.kind === "constant") {
        const const_ = symbol as ConstantSymbol;
        if (const_.resolvedValue) {
          expressions.push({
            name: const_.fullyQualifiedName,
            value: const_.resolvedValue.raw || String(const_.value),
            line: const_.location.line,
          });
        }
      }
    }

    console.log(`\n  📊 Found ${expressions.length} expression(s):\n`);

    for (const expr of expressions) {
      console.log(`  🔍 ${expr.name} (line ${expr.line})`);
      console.log(`     Source: ${expr.value}`);
      try {
        const ast = expressionParser.parse(expr.value);
        console.log(`     AST:    ${ast.kind}`);
      } catch (error: any) {
        console.log(`     ⚠️  Parse error: ${error.message}`);
      }
      console.log();
    }
  }
  process.exit(0);
}

// ── default: pretty formatted output ─────────────────────────────────────────
printPrettyOutput(symbolTable, filePath);

// ── Helper Functions ─────────────────────────────────────────────────────────

function printPrettyOutput(symbolTable: SymbolTable, filePath: string): void {
  console.log("\n" + "═".repeat(80));
  console.log(`  PHP SYMBOL TABLE  ·  ${path.basename(filePath)}`);
  console.log("═".repeat(80));

  console.log(`\n  📊 Overview:`);
  console.log(`     Total Symbols:     ${symbolTable.statistics.totalSymbols}`);
  console.log(`     Classes:           ${symbolTable.statistics.totalClasses}`);
  console.log(
    `     Interfaces:        ${symbolTable.statistics.totalInterfaces}`,
  );
  console.log(`     Traits:            ${symbolTable.statistics.totalTraits}`);
  console.log(`     Enums:             ${symbolTable.statistics.totalEnums}`);
  console.log(
    `     Functions:         ${symbolTable.statistics.totalFunctions}`,
  );
  console.log(`     Methods:           ${symbolTable.statistics.totalMethods}`);
  console.log(
    `     Properties:        ${symbolTable.statistics.totalProperties}`,
  );
  console.log(
    `     Constants:         ${symbolTable.statistics.totalConstants}`,
  );
  console.log(
    `     Closures:          ${symbolTable.statistics.totalClosures}`,
  );
  console.log(
    `     References:        ${symbolTable.statistics.totalReferences}`,
  );

  // Classes
  const classes = Array.from(symbolTable.byName.values()).filter(
    (s) => s.kind === "class",
  );
  if (classes.length > 0) {
    console.log(`\n  📦 Classes (${classes.length}):`);
    for (const sym of classes) {
      const cls = sym as ClassSymbol;
      const decorator = cls.isAbstract
        ? "abstract "
        : cls.isFinal
          ? "final "
          : "";
      console.log(`     ${decorator}${cls.name}`);
      if (cls.extends) {
        console.log(`        extends ${cls.extends}`);
      }
      if (cls.implements.length) {
        console.log(`        implements ${cls.implements.join(", ")}`);
      }
      if (cls.uses.length) {
        console.log(`        uses ${cls.uses.join(", ")}`);
      }
    }
  }

  // Interfaces
  const interfaces = Array.from(symbolTable.byName.values()).filter(
    (s) => s.kind === "interface",
  );
  if (interfaces.length > 0) {
    console.log(`\n  🤝 Interfaces (${interfaces.length}):`);
    for (const intf of interfaces) {
      console.log(`     ${intf.name}`);
    }
  }

  // Traits
  const traits = Array.from(symbolTable.byName.values()).filter(
    (s) => s.kind === "trait",
  );
  if (traits.length > 0) {
    console.log(`\n  🧬 Traits (${traits.length}):`);
    for (const trait of traits) {
      console.log(`     ${trait.name}`);
    }
  }

  // Enums
  const enums = Array.from(symbolTable.byName.values()).filter(
    (s) => s.kind === "enum",
  );
  if (enums.length > 0) {
    console.log(`\n  📋 Enums (${enums.length}):`);
    for (const e of enums) {
      console.log(`     ${e.name}`);
    }
  }

  // Functions
  const functions = Array.from(symbolTable.byName.values()).filter(
    (s) => s.kind === "function",
  );
  if (functions.length > 0) {
    console.log(`\n  🔧 Functions (${functions.length}):`);
    for (const sym of functions) {
      const func = sym as FunctionSymbol;
      const params = func.parameters.map((p) => p.name).join(", ");
      const returnType = func.returnType ? `: ${func.returnType}` : "";
      console.log(`     ${func.name}(${params})${returnType}`);
    }
  }

  // Inheritance Graph
  if (symbolTable.inheritanceGraph.size > 0) {
    console.log(`\n  🏗️ Inheritance Graph:`);
    for (const [parent, children] of symbolTable.inheritanceGraph) {
      console.log(`     ${parent} ← ${children.join(", ")}`);
    }
  }

  // Namespaces
  if (symbolTable.namespaces.size > 0) {
    console.log(`\n  📁 Namespaces:`);
    for (const [name, ns] of symbolTable.namespaces) {
      console.log(`     ${name} (${ns.symbols.size} symbols)`);
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("\n  💡 Tips:");
  console.log("     --json               → Full JSON output");
  console.log("     --symbol <name>      → Show symbol details");
  console.log("     --ast '<expr>'       → Parse expression to AST");
  console.log();
} */

// index.ts
import * as fs from 'fs';
import * as path from 'path';
import { PHPBlockParser } from './parser/PHPBlockParser';

const args = process.argv.slice(2);
const phpFile = args.find(a => !a.startsWith('--'));
const jsonMode = args.includes('--json');

if (!phpFile) {
  console.error('Usage: ts-node index.ts <file.php> [--json]');
  process.exit(1);
}

const filePath = path.resolve(phpFile);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

console.error('Parsing with simple ordered pass parser...');
const content = fs.readFileSync(filePath, 'utf-8');
const parser = new PHPBlockParser();
const symbols = parser.parse(content);
console.error('Done.\n');

if (jsonMode) {
  console.log(parser.exportToJSON());
} else {
  parser.printSymbols();
}