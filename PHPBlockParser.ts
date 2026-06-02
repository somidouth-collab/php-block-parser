// PHPBlockParser.ts - Simple ordered pass parser

export interface ParsedSymbol {
  id: string;
  kind: string;
  name: string;
  fqn: string;
  line: number;
  endLine?: number;
  parent?: string;
  namespace?: string;
  visibility?: string;
  isStatic?: boolean;
  isAbstract?: boolean;
  isFinal?: boolean;
  isReadonly?: boolean;
  returnType?: string;
  parameters?: Array<{ name: string; type?: string }>;
  value?: string;
  type?: string;
  children: ParsedSymbol[];
}

export class PHPBlockParser {
  private lines: string[] = [];
  private symbols: ParsedSymbol[] = [];
  private namespace: string = '';
  private currentClass: ParsedSymbol | null = null;
  
  // Indexes for strings and comments (to skip during parsing)
  private stringIndex: Map<number, number[]> = new Map(); // line -> [start, end] positions
  private commentIndex: Map<number, number[]> = new Map(); // line -> [start, end] positions

  parse(content: string): ParsedSymbol[] {
    this.lines = content.split('\n');
    this.symbols = [];
    this.namespace = '';
    this.currentClass = null;
    this.stringIndex.clear();
    this.commentIndex.clear();

    // PASS 1: Index all strings and comments (mark positions to skip)
    this.indexStrings();
    this.indexComments();

    // PASS 2: Parse namespace (first line with 'namespace')
    this.parseNamespace();

    // PASS 3: Parse global functions (lines starting with 'function')
    this.parseGlobalFunctions();

    // PASS 4: Parse classes, interfaces, traits, enums
    this.parseTypes();

    // PASS 5: Parse global constants (lines starting with 'const')
    this.parseGlobalConstants();

    // PASS 6: Parse closures assigned to variables
    this.parseClosures();

    return this.symbols;
  }

  private isInStringOrComment(line: number, col: number): boolean {
    // Check string index
    const stringPositions = this.stringIndex.get(line);
    if (stringPositions) {
      for (let i = 0; i < stringPositions.length; i += 2) {
        if (col >= stringPositions[i] && col <= stringPositions[i + 1]) {
          return true;
        }
      }
    }
    
    // Check comment index
    const commentPositions = this.commentIndex.get(line);
    if (commentPositions) {
      for (let i = 0; i < commentPositions.length; i += 2) {
        if (col >= commentPositions[i] && col <= commentPositions[i + 1]) {
          return true;
        }
      }
    }
    
    return false;
  }

  private indexStrings(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum];
      const positions: number[] = [];
      let inString = false;
      let stringStart = -1;
      let stringChar = '';
      
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const prev = i > 0 ? line[i - 1] : '';
        
        if (!inString && (ch === '"' || ch === "'") && prev !== '\\') {
          inString = true;
          stringStart = i;
          stringChar = ch;
        } else if (inString && ch === stringChar && prev !== '\\') {
          positions.push(stringStart, i);
          inString = false;
        }
      }
      
      if (positions.length > 0) {
        this.stringIndex.set(lineNum, positions);
      }
    }
  }

  private indexComments(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum];
      const positions: number[] = [];
      
      // Single line comments // or #
      let commentStart = -1;
      for (let i = 0; i < line.length - 1; i++) {
        if (!this.isInStringOrComment(lineNum, i) && 
            (line[i] === '/' && line[i + 1] === '/')) {
          commentStart = i;
          positions.push(commentStart, line.length - 1);
          break;
        }
        if (!this.isInStringOrComment(lineNum, i) && line[i] === '#') {
          commentStart = i;
          positions.push(commentStart, line.length - 1);
          break;
        }
      }
      
      // Multi-line comments /* */
      if (!this.isInStringOrComment(lineNum, 0)) {
        let inMultiline = false;
        let multilineStart = -1;
        
        for (let i = 0; i < line.length - 1; i++) {
          if (!inMultiline && line[i] === '/' && line[i + 1] === '*') {
            inMultiline = true;
            multilineStart = i;
          } else if (inMultiline && line[i] === '*' && line[i + 1] === '/') {
            positions.push(multilineStart, i + 1);
            inMultiline = false;
            multilineStart = -1;
          }
        }
        
        // Handle multi-line comment that continues to next line
        if (inMultiline && multilineStart !== -1) {
          positions.push(multilineStart, line.length - 1);
        }
      }
      
      if (positions.length > 0) {
        this.commentIndex.set(lineNum, positions);
      }
    }
  }

  private parseNamespace(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum].trim();
      if (line.startsWith('namespace ') && !this.isInStringOrComment(lineNum, 0)) {
        const match = line.match(/namespace\s+([a-zA-Z_\\]+)/);
        if (match) {
          this.namespace = match[1];
          this.symbols.push({
            id: `ns_${this.namespace}`,
            kind: 'namespace',
            name: this.namespace,
            fqn: this.namespace,
            line: lineNum + 1,
            children: []
          });
        }
        break;
      }
    }
  }

  private parseGlobalFunctions(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum].trim();
      
      // Skip if not a function declaration
      if (!line.startsWith('function ') || this.isInStringOrComment(lineNum, 0)) {
        continue;
      }
      
      // Extract function name
      const afterFunction = line.substring(9); // after 'function '
      const parenIndex = afterFunction.indexOf('(');
      if (parenIndex === -1) continue;
      
      let name = afterFunction.substring(0, parenIndex).trim();
      if (name.startsWith('&')) name = name.substring(1); // remove reference
      
      const fqn = this.namespace ? `${this.namespace}\\${name}` : name;
      
      // Extract parameters
      const paramsEnd = afterFunction.indexOf(')');
      const paramStr = afterFunction.substring(parenIndex + 1, paramsEnd);
      const parameters = this.parseParameters(paramStr);
      
      // Extract return type
      let returnType: string | undefined;
      const colonIndex = afterFunction.indexOf(':');
      if (colonIndex !== -1 && colonIndex > paramsEnd) {
        const returnPart = afterFunction.substring(colonIndex + 1).trim();
        const spaceIndex = returnPart.indexOf(' ');
        returnType = spaceIndex !== -1 ? returnPart.substring(0, spaceIndex) : returnPart;
      }
      
      this.symbols.push({
        id: `func_${fqn}`,
        kind: 'function',
        name,
        fqn,
        line: lineNum + 1,
        returnType,
        parameters,
        children: []
      });
    }
  }

  private parseTypes(): void {
    let i = 0;
    while (i < this.lines.length) {
      const originalLine = this.lines[i];
      const line = originalLine.trim();
      
      if (this.isInStringOrComment(i, 0)) {
        i++;
        continue;
      }
      
      let kind = '';
      if (line.startsWith('class ')) kind = 'class';
      else if (line.startsWith('abstract class ')) kind = 'class';
      else if (line.startsWith('final class ')) kind = 'class';
      else if (line.startsWith('readonly class ')) kind = 'class';
      else if (line.startsWith('interface ')) kind = 'interface';
      else if (line.startsWith('trait ')) kind = 'trait';
      else if (line.startsWith('enum ')) kind = 'enum';
      
      if (kind) {
        // Extract name - the word after the kind
        const parts = line.split(/\s+/);
        let nameIndex = parts[0] === 'abstract' || parts[0] === 'final' || parts[0] === 'readonly' ? 2 : 1;
        const name = parts[nameIndex];
        
        // Find body boundaries by counting braces
        let braceCount = 0;
        let bodyStart = -1;
        let bodyEnd = i;
        
        for (let j = i; j < this.lines.length; j++) {
          const currentLine = this.lines[j];
          for (let k = 0; k < currentLine.length; k++) {
            const ch = currentLine[k];
            if (this.isInStringOrComment(j, k)) continue;
            if (ch === '{') {
              braceCount++;
              if (bodyStart === -1) bodyStart = j;
            } else if (ch === '}') {
              braceCount--;
              if (braceCount === 0 && bodyStart !== -1) {
                bodyEnd = j;
                break;
              }
            }
          }
          if (braceCount === 0 && bodyStart !== -1) break;
        }
        
        // Parse extends
        let parent: string | undefined;
        const extendsMatch = line.match(/extends\s+([a-zA-Z_\\]+)/);
        if (extendsMatch) parent = extendsMatch[1];
        
        const isAbstract = line.includes('abstract');
        const isFinal = line.includes('final');
        const isReadonly = line.includes('readonly');
        
        const fqn = this.namespace ? `${this.namespace}\\${name}` : name;
        
        const classSymbol: ParsedSymbol = {
          id: `${kind}_${fqn}`,
          kind,
          name,
          fqn,
          line: i + 1,
          endLine: bodyEnd + 1,
          parent,
          namespace: this.namespace || undefined,
          isAbstract,
          isFinal,
          isReadonly,
          children: []
        };
        
        this.symbols.push(classSymbol);
        
        // Parse class members (inside the body)
        const oldClass = this.currentClass;
        this.currentClass = classSymbol;
        this.parseClassMembers(bodyStart + 1, bodyEnd - 1);
        this.currentClass = oldClass;
        
        i = bodyEnd + 1;
        continue;
      }
      
      i++;
    }
  }

  private parseClassMembers(startLine: number, endLine: number): void {
    if (!this.currentClass) return;
    
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const line = this.lines[lineNum].trim();
      if (line === '' || this.isInStringOrComment(lineNum, 0)) continue;
      
      // Parse property
      const propMatch = line.match(/^(public|protected|private)\s+(?:static\s+)?(?:readonly\s+)?\$([a-zA-Z_]+)/);
      if (propMatch && !line.includes('function')) {
        const visibility = propMatch[1];
        const name = `$${propMatch[2]}`;
        
        // Extract type
        let type: string | undefined;
        const typeMatch = line.match(/(?:public|protected|private)\s+(?:static\s+)?(?:readonly\s+)?([a-zA-Z_?]+)\s+\$/);
        if (typeMatch) type = typeMatch[1];
        
        const isStatic = line.includes('static');
        const isReadonly = line.includes('readonly');
        
        this.currentClass.children.push({
          id: `prop_${this.currentClass.fqn}::${name}`,
          kind: 'property',
          name,
          fqn: `${this.currentClass.fqn}::${name}`,
          line: lineNum + 1,
          visibility,
          type,
          isStatic,
          isReadonly,
          parent: this.currentClass.name,
          children: []
        });
        continue;
      }
      
      // Parse method
      const methodMatch = line.match(/^(public|protected|private)\s+(?:static\s+)?(?:abstract\s+)?(?:final\s+)?function\s+&?([a-zA-Z_]+)\s*\(/);
      if (methodMatch) {
        const visibility = methodMatch[1];
        const name = methodMatch[2];
        const isStatic = line.includes('static');
        const isAbstract = line.includes('abstract');
        const isFinal = line.includes('final');
        
        // Extract parameters
        const parenOpen = line.indexOf('(');
        const parenClose = line.indexOf(')');
        const paramStr = parenOpen !== -1 && parenClose !== -1 ? line.substring(parenOpen + 1, parenClose) : '';
        const parameters = this.parseParameters(paramStr);
        
        // Extract return type
        let returnType: string | undefined;
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1 && colonIndex > parenClose) {
          const returnPart = line.substring(colonIndex + 1).trim();
          const spaceIndex = returnPart.indexOf(' ');
          const braceIndex = returnPart.indexOf('{');
          const endIndex = spaceIndex !== -1 ? spaceIndex : (braceIndex !== -1 ? braceIndex : returnPart.length);
          returnType = returnPart.substring(0, endIndex).trim();
        }
        
        const isConstructor = name === '__construct';
        const isDestructor = name === '__destruct';
        
        this.currentClass.children.push({
          id: `method_${this.currentClass.fqn}::${name}`,
          kind: isConstructor ? 'constructor' : (isDestructor ? 'destructor' : 'method'),
          name,
          fqn: `${this.currentClass.fqn}::${name}`,
          line: lineNum + 1,
          visibility,
          isStatic,
          isAbstract,
          isFinal,
          returnType,
          parameters,
          parent: this.currentClass.name,
          children: []
        });
        continue;
      }
    }
  }

  private parseGlobalConstants(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum].trim();
      
      if (!line.startsWith('const ') || this.isInStringOrComment(lineNum, 0)) {
        continue;
      }
      
      const match = line.match(/const\s+([a-zA-Z_]+)\s*=\s*(.+?);/);
      if (match) {
        const name = match[1];
        const value = match[2].trim();
        const fqn = this.namespace ? `${this.namespace}\\${name}` : name;
        
        this.symbols.push({
          id: `const_${fqn}`,
          kind: 'constant',
          name,
          fqn,
          line: lineNum + 1,
          value,
          namespace: this.namespace || undefined,
          children: []
        });
      }
    }
  }

  private parseClosures(): void {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum];
      
      if (this.isInStringOrComment(lineNum, 0)) continue;
      
      // Match $var = function(...) or $var = fn(...)
      const match = line.match(/^\$([a-zA-Z_]+)\s*=\s*(?:static\s+)?(function|fn)\s*\(/);
      if (match) {
        const varName = `$${match[1]}`;
        const isArrow = match[2] === 'fn';
        
        // Extract parameters
        const parenOpen = line.indexOf('(');
        const parenClose = line.indexOf(')');
        const paramStr = parenOpen !== -1 && parenClose !== -1 ? line.substring(parenOpen + 1, parenClose) : '';
        const parameters = this.parseParameters(paramStr);
        
        // Extract return type for arrow functions
        let returnType: string | undefined;
        if (isArrow) {
          const arrowIndex = line.indexOf('=>');
          if (arrowIndex !== -1) {
            const afterArrow = line.substring(arrowIndex + 2).trim();
            // Arrow function may have return type before =>
            const colonIndex = line.indexOf(':');
            if (colonIndex !== -1 && colonIndex < arrowIndex) {
              const returnPart = line.substring(parenClose + 1, colonIndex).trim();
              returnType = returnPart;
            }
          }
        }
        
        const fqn = this.namespace ? `${this.namespace}\\${varName}` : varName;
        
        this.symbols.push({
          id: `closure_${fqn}`,
          kind: 'closure',
          name: varName,
          fqn,
          line: lineNum + 1,
          returnType,
          parameters,
          children: []
        });
      }
    }
  }

  private parseParameters(paramStr: string): Array<{ name: string; type?: string }> {
    const params: Array<{ name: string; type?: string }> = [];
    if (!paramStr.trim()) return params;
    
    // Simple split by comma (not handling nested arrays, good enough)
    const parts = paramStr.split(',');
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      // Extract parameter name (starts with $)
      const dollarIndex = trimmed.indexOf('$');
      if (dollarIndex === -1) continue;
      
      let name = trimmed.substring(dollarIndex);
      const spaceIndex = name.indexOf(' ');
      if (spaceIndex !== -1) name = name.substring(0, spaceIndex);
      
      // Extract type (anything before the $)
      let type: string | undefined;
      if (dollarIndex > 0) {
        type = trimmed.substring(0, dollarIndex).trim();
        if (type === '...' || type === '&') type = undefined;
      }
      
      params.push({ name, type });
    }
    
    return params;
  }

  printSymbols(): void {
    console.log('\n' + '═'.repeat(80));
    console.log('  PHP SYMBOL TABLE (Simple Ordered Pass)');
    console.log('═'.repeat(80));
    
    const byKind: Record<string, ParsedSymbol[]> = {};
    for (const sym of this.symbols) {
      if (!byKind[sym.kind]) byKind[sym.kind] = [];
      byKind[sym.kind].push(sym);
    }
    
    console.log(`\n  📊 Statistics:`);
    console.log(`     Total:     ${this.symbols.length}`);
    console.log(`     Namespace: ${byKind['namespace']?.length || 0}`);
    console.log(`     Classes:   ${byKind['class']?.length || 0}`);
    console.log(`     Interfaces:${byKind['interface']?.length || 0}`);
    console.log(`     Traits:    ${byKind['trait']?.length || 0}`);
    console.log(`     Enums:     ${byKind['enum']?.length || 0}`);
    console.log(`     Functions: ${byKind['function']?.length || 0}`);
    console.log(`     Methods:   ${byKind['method']?.length || 0}`);
    console.log(`     Properties:${byKind['property']?.length || 0}`);
    console.log(`     Constants: ${byKind['constant']?.length || 0}`);
    console.log(`     Closures:  ${byKind['closure']?.length || 0}`);
    
    // Print classes with their children
    const classes = byKind['class'] || [];
    for (const cls of classes) {
      console.log(`\n  📦 ${cls.isAbstract ? 'abstract ' : ''}${cls.isFinal ? 'final ' : ''}${cls.isReadonly ? 'readonly ' : ''}${cls.name}`);
      if (cls.parent) console.log(`     extends: ${cls.parent}`);
      console.log(`     line: ${cls.line}`);
      
      const methods = cls.children.filter(c => c.kind === 'method' || c.kind === 'constructor' || c.kind === 'destructor');
      if (methods.length) {
        console.log(`     methods: ${methods.map(m => m.name).join(', ')}`);
      }
      
      const props = cls.children.filter(c => c.kind === 'property');
      if (props.length) {
        console.log(`     properties: ${props.map(p => p.name).join(', ')}`);
      }
    }
    
    // Print global functions
    const functions = byKind['function'] || [];
    if (functions.length) {
      console.log(`\n  🔧 Functions (${functions.length}):`);
      for (const fn of functions) {
        const params = fn.parameters?.map(p => p.name).join(', ') || '';
        console.log(`     ${fn.name}(${params})${fn.returnType ? ': ' + fn.returnType : ''} (line ${fn.line})`);
      }
    }
    
    // Print global constants
    const constants = byKind['constant'] || [];
    if (constants.length) {
      console.log(`\n  📌 Constants (${constants.length}):`);
      for (const c of constants) {
        console.log(`     ${c.name} = ${c.value} (line ${c.line})`);
      }
    }
    
    console.log('\n' + '═'.repeat(80));
  }

  exportToJSON(): string {
    return JSON.stringify(this.symbols, null, 2);
  }
}
