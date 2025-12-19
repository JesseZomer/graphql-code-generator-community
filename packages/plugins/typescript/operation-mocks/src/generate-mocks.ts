import { writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import {
  Project,
  PropertySignature,
  SyntaxKind,
  TypeAliasDeclaration,
  TypeLiteralNode,
} from 'ts-morph';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a parsed GraphQL operation type extracted from typescript-operations output.
 *
 * The typescript-operations plugin generates verbose type names like:
 *   `MentoraatResultatenContextQuery_mentoraatResultatenContext_MentoraatResultatenContext`
 *
 * We parse these into structured data to generate cleaner aliases and mock functions.
 */
interface ParsedType {
  /** Original verbose type name from typescript-operations (e.g., `MessagesQuery_messages_Message`) */
  verboseName: string;
  /** The GraphQL operation name (e.g., `Messages`, `MentoraatResultatenContext`) */
  operationName: string;
  /** Whether this is a Query, Mutation, or Subscription */
  operationType: 'Query' | 'Mutation' | 'Subscription';
  /** Path segments from the verbose name: [rootField, RootType, nestedField, NestedType, ...] */
  pathSegments: string[];
  /** Clean alias name we generate (e.g., `Query_Messages`, `Query_Messages_Author`) */
  aliasName: string;
  /** The GraphQL __typename value (e.g., `Message`, `Author`) */
  typename: string;
  /** All fields of this type with their parsed metadata */
  fields: ParsedField[];
}

/**
 * Represents a single field within a parsed type.
 */
interface ParsedField {
  /** Field name (e.g., `id`, `naam`, `stamgroepen`) */
  name: string;
  /** Raw TypeScript type string (e.g., `string`, `Array<SomeType> | null`) */
  type: string;
  /** Whether this field is an array type */
  isArray: boolean;
  /** Whether this field is nullable (optional or `| null`) */
  isNullable: boolean;
  /** If this field references another parsed type, the alias name of that type */
  referencedType?: string;
  /** If this field is an enum, the full enum reference (e.g., `Types.DbResultaatkolomtype`) */
  enumType?: string;
}

// ============================================================================
// Constants & Patterns
// ============================================================================

/**
 * Matches verbose typescript-operations type names and captures:
 * - Group 1: Operation name (e.g., `MentoraatResultatenContext`)
 * - Group 2: Operation type (`Query`, `Mutation`, `Subscription`)
 * - Group 3: Path part after the operation type (e.g., `mentoraatResultatenContext_MentoraatResultatenContext`)
 */
const VERBOSE_TYPE_NAME_PATTERN = /^([A-Z][a-zA-Z]+)(Query|Mutation|Subscription)_(.+)$/;

/**
 * Matches TypeScript import() type references and captures the type name.
 * ts-morph returns types like `import("/path/to/file").TypeName` for cross-file references.
 */
const IMPORT_TYPE_REFERENCE_PATTERN = /import\([^)]+\)\.([A-Za-z_][A-Za-z0-9_]*)/;

/** Matches quoted strings to extract __typename values like `'Message'` or `"Message"` */
const QUOTED_STRING_PATTERN = /['"]([^'"]+)['"]/;

/** Matches enum type references, optionally prefixed with `Types.` */
const ENUM_TYPE_PATTERN = /^(?:Types\.)?([A-Z][A-Za-z0-9]*)/;

/** Root GraphQL operation types that we skip (they just wrap the actual data type) */
const ROOT_GRAPHQL_OPERATION_TYPES = ['Query', 'Mutation', 'Subscription'];

/** Built-in types that should not be treated as enums */
const BUILTIN_TYPE_NAMES = ['Array', 'String', 'Number', 'Boolean', 'Date'];

// ============================================================================
// Pure Utility Functions
// ============================================================================

const capitalizeFirst = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

const lowercaseFirst = (str: string): string => str.charAt(0).toLowerCase() + str.slice(1);

/** Remove `| null` from a type string */
const stripNullable = (type: string): string => type.replace(/\s*\|\s*null/g, '');

/** Unwrap `Array<T>` or `T[]` to just `T` */
const stripArrayWrapper = (type: string): string =>
  type.replace(/Array<(.+)>/g, '$1').replace(/\[\]/g, '');

/** Extract the base type from a potentially wrapped type (removes nullable, array, optional markers) */
const getBaseType = (typeText: string): string =>
  [
    stripNullable,
    stripArrayWrapper,
    (s: string) => s.replace(/\?/g, ''),
    (s: string) => s.trim(),
  ].reduce((acc, fn) => fn(acc), typeText);

/** Extract the actual type name from an import() reference, or return the original if not an import */
const extractTypeFromImportReference = (type: string): string => {
  const match = type.match(IMPORT_TYPE_REFERENCE_PATTERN);
  return match ? match[1] : type;
};

/** Check if path segments represent a root operation type (e.g., just `Query`) that we should skip */
const isRootOperationType = (pathSegments: string[]): boolean =>
  pathSegments.length === 1 && ROOT_GRAPHQL_OPERATION_TYPES.includes(pathSegments[0]);

/** Group items by a key function into a Map */
const groupBy = <T, K extends string | number>(items: T[], getKey: (item: T) => K): Map<K, T[]> =>
  items.reduce((groupedMap, item) => {
    const key = getKey(item);
    const existingGroup = groupedMap.get(key) || [];
    return groupedMap.set(key, [...existingGroup, item]);
  }, new Map<K, T[]>());

// ============================================================================
// Alias Name Building
// ============================================================================

/**
 * Build clean alias name segments from verbose path segments.
 *
 * The verbose path alternates between field names (camelCase) and type names (PascalCase):
 *   `[rootField, RootType, nestedField1, NestedType1, nestedField2, NestedType2]`
 *
 * We extract only the field names (at even indices after skipping the first pair):
 *   `[OperationName, NestedField1, NestedField2]` → `Query_OperationName_NestedField1_NestedField2`
 */
const buildAliasSegments = (operationName: string, pathSegments: string[]): string[] => {
  const nestedFieldNames = pathSegments
    .slice(2) // Skip root field and root type
    .filter((_, index) => index % 2 === 0) // Take only field names (even indices)
    .map(capitalizeFirst);

  return [operationName, ...nestedFieldNames];
};

/**
 * Parse a verbose typescript-operations type name into structured data.
 *
 * Example: `MentoraatResultatenContextQuery_mentoraatResultatenContext_MentoraatResultatenContext`
 * Returns: { operationName: 'MentoraatResultatenContext', aliasName: 'Query_MentoraatResultatenContext', ... }
 */
const parseVerboseTypeName = (typeName: string): Omit<ParsedType, 'fields' | 'typename'> | null => {
  const match = typeName.match(VERBOSE_TYPE_NAME_PATTERN);
  if (!match) return null;

  const [, operationName, operationType, pathPart] = match;
  const pathSegments = pathPart.split('_');
  const aliasSegments = buildAliasSegments(operationName, pathSegments);

  return {
    verboseName: typeName,
    operationName,
    operationType: operationType as 'Query' | 'Mutation' | 'Subscription',
    pathSegments,
    aliasName: `${operationType}_${aliasSegments.join('_')}`,
  };
};

// ============================================================================
// Type Alias Extraction (ts-morph helpers)
// ============================================================================

/** Safely extract the TypeLiteralNode from a type alias, or null if it's not a type literal */
const getTypeLiteral = (typeAlias: TypeAliasDeclaration): TypeLiteralNode | null => {
  const typeNode = typeAlias.getTypeNode();
  return typeNode?.getKind() === SyntaxKind.TypeLiteral ? (typeNode as TypeLiteralNode) : null;
};

/** Extract the __typename value from a type alias (e.g., `'Message'` → `Message`) */
const extractTypename = (typeAlias: TypeAliasDeclaration): string | null => {
  const typeLiteral = getTypeLiteral(typeAlias);
  const typenameProperty = typeLiteral?.getProperty('__typename') as PropertySignature | undefined;
  const typenameTypeText = typenameProperty?.getType()?.getText() || '';
  const match = typenameTypeText.match(QUOTED_STRING_PATTERN);
  return match?.[1] || null;
};

// ============================================================================
// Field Parsing
// ============================================================================

/** Detect if a type is an enum reference (e.g., `Types.DbResultaatkolomtype`) */
const detectEnumType = (cleanType: string, originalTypeText: string): string | undefined => {
  const isFromTypesImport =
    cleanType.startsWith('Types.') || originalTypeText.includes('base-types');
  if (!isFromTypesImport) return undefined;

  const match = cleanType.match(ENUM_TYPE_PATTERN);
  const isBuiltinType = match && BUILTIN_TYPE_NAMES.includes(match[1]);
  return match && !isBuiltinType ? `Types.${match[1]}` : undefined;
};

/** Parse a single property signature into a ParsedField */
const parseField = (
  propertySignature: PropertySignature,
  verboseTypesMap: Map<string, ParsedType>,
): ParsedField | null => {
  const fieldName = propertySignature.getName();
  if (fieldName === '__typename') return null;

  const rawTypeText = propertySignature.getType()?.getText() || 'unknown';
  const cleanedType = extractTypeFromImportReference(getBaseType(rawTypeText));
  const referencedParsedType = verboseTypesMap.get(cleanedType);

  return {
    name: fieldName,
    type: rawTypeText,
    isArray: rawTypeText.startsWith('Array<') || rawTypeText.includes('[]'),
    isNullable: rawTypeText.includes('| null') || propertySignature.hasQuestionToken(),
    referencedType: referencedParsedType?.aliasName,
    enumType: referencedParsedType ? undefined : detectEnumType(cleanedType, rawTypeText),
  };
};

/** Parse all fields from a type alias */
const parseFields = (
  typeAlias: TypeAliasDeclaration,
  verboseTypesMap: Map<string, ParsedType>,
): ParsedField[] => {
  const typeLiteral = getTypeLiteral(typeAlias);
  if (!typeLiteral) return [];

  return typeLiteral
    .getProperties()
    .filter(prop => prop.getKind() === SyntaxKind.PropertySignature)
    .map(prop => parseField(prop as PropertySignature, verboseTypesMap))
    .filter((field): field is ParsedField => field !== null);
};

// ============================================================================
// File Parsing
// ============================================================================

/**
 * Parse a .types.ts file and extract all verbose types with their fields.
 *
 * This is done in two passes:
 * 1. First pass: Collect all verbose types without fields (needed for reference resolution)
 * 2. Second pass: Parse fields for each type, resolving references to other types
 */
const parseTypesFile = (filePath: string, project: Project): ParsedType[] => {
  const sourceFile = project.addSourceFileAtPath(filePath);
  const allTypeAliases = sourceFile.getTypeAliases();

  // First pass: Build a map of all verbose types (without fields yet)
  // We need this map first so we can resolve field references in the second pass
  const verboseTypesMap = allTypeAliases.reduce((map, typeAlias) => {
    const typeAliasName = typeAlias.getName();
    const parsedMetadata = parseVerboseTypeName(typeAliasName);
    const graphqlTypename = extractTypename(typeAlias);

    const isValidVerboseType =
      parsedMetadata && graphqlTypename && !isRootOperationType(parsedMetadata.pathSegments);
    if (isValidVerboseType) {
      map.set(typeAliasName, { ...parsedMetadata, typename: graphqlTypename, fields: [] });
    }
    return map;
  }, new Map<string, ParsedType>());

  // Second pass: Parse fields for each type, now that we can resolve references
  allTypeAliases.forEach(typeAlias => {
    const parsedType = verboseTypesMap.get(typeAlias.getName());
    if (parsedType) {
      parsedType.fields = parseFields(typeAlias, verboseTypesMap);
    }
  });

  return Array.from(verboseTypesMap.values());
};

// ============================================================================
// Aliases File Generation
// ============================================================================

/** Generate a single type alias export line */
const generateAliasExportLine = (type: ParsedType): string =>
  `export type ${type.aliasName} = VerboseTypes.${type.verboseName};`;

/**
 * Generate the content for a .aliases.ts file.
 *
 * Creates clean type aliases that map to the verbose typescript-operations types:
 *   `export type Query_Messages = VerboseTypes.MessagesQuery_messages_Message;`
 */
const generateAliasesFileContent = (parsedTypes: ParsedType[], typesFileName: string): string => {
  const fileHeader = [
    `// This file is auto-generated by generateMocksForDomains, do not edit manually`,
    `import type * as VerboseTypes from './${typesFileName}';`,
    ``,
  ];

  // Group types by operation for better organization in the output file
  const typesByOperation = groupBy(
    parsedTypes,
    type => `${type.operationName}${type.operationType}`,
  );
  const aliasBlocksPerOperation = Array.from(typesByOperation.values()).map(typesInOperation =>
    typesInOperation.map(generateAliasExportLine).join('\n'),
  );

  return [...fileHeader, ...aliasBlocksPerOperation].join('\n');
};

// ============================================================================
// Mock Value Generation
// ============================================================================

/**
 * Generators for mock values of primitive types.
 * Each generator returns a TypeScript expression string for the mock value.
 */
const primitiveTypeMockGenerators: Record<
  string,
  (field: ParsedField, contextPath: string) => string
> = {
  string: (field, contextPath) => {
    const mockStringValue = `${contextPath}_${field.name}`;
    if (field.isArray) return `['${mockStringValue}_0', '${mockStringValue}_1']`;
    // ID fields get arrayIndex support for unique values in arrays
    if (field.name === 'id' || field.name.endsWith('Id')) {
      return `\`${mockStringValue}\${arrayIndex ? \`_\${arrayIndex}\` : ''}\``;
    }
    return `'${field.name}'`;
  },
  number: field => {
    if (field.isArray) return '[1, 2]';
    // Use floating point for fields that might be decimals
    const isLikelyFloat =
      field.name.toLowerCase().includes('cijfer') || field.name.toLowerCase().includes('float');
    return isLikelyFloat ? '1.0' : '1';
  },
  boolean: field => (field.isArray ? '[true, false]' : 'true'),
  Date: field => (field.isArray ? '[new Date(), new Date()]' : 'new Date()'),
};

/**
 * Generate a mock value expression for a field.
 *
 * Handles:
 * - Referenced types: Calls the corresponding fake_* function
 * - Enums: Uses the first enum value
 * - Primitives: Uses the appropriate generator from primitiveTypeMockGenerators
 */
const generateMockValueExpression = (field: ParsedField, contextPath: string): string => {
  // For fields that reference other parsed types, call their fake function
  if (field.referencedType) {
    const referencedFakeFunctionName = `fake_${field.referencedType.replace(/^(Query|Mutation|Subscription)_/, '')}`;
    return field.isArray
      ? `[${referencedFakeFunctionName}('0'), ${referencedFakeFunctionName}('1')]`
      : `${referencedFakeFunctionName}('')`;
  }

  // For enum fields, use the first enum value
  if (field.enumType) {
    const enumName = field.enumType.replace('Types.', '');
    return `Types.${enumName}[Object.keys(Types.${enumName})[0] as keyof typeof Types.${enumName}]`;
  }

  // For primitive types, use the appropriate generator
  const baseType = getBaseType(field.type);
  const primitiveGenerator = primitiveTypeMockGenerators[baseType];
  return primitiveGenerator
    ? primitiveGenerator(field, contextPath)
    : `undefined as any /* TODO: ${field.type} */`;
};

// ============================================================================
// Mock Function Generation
// ============================================================================

/**
 * Generate a fake_* factory function for a parsed type.
 *
 * Example output:
 * ```typescript
 * export const fake_Messages = (arrayIndex: string = '', overrides?: Partial<AliasTypes.Query_Messages>): AliasTypes.Query_Messages => {
 *   return {
 *     __typename: 'Message',
 *     id: `messages_id${arrayIndex ? `_${arrayIndex}` : ''}`,
 *     text: 'text',
 *     ...overrides,
 *   };
 * };
 * ```
 */
const generateMockFactoryFunction = (type: ParsedType): string => {
  const functionName = `fake_${type.aliasName.replace(/^(Query|Mutation|Subscription)_/, '')}`;
  const mockContextPath = lowercaseFirst(
    type.aliasName.replace(/^(Query|Mutation|Subscription)_/, '').replace(/_/g, '_'),
  );

  const fieldMockAssignments = type.fields.map(
    field => `    ${field.name}: ${generateMockValueExpression(field, mockContextPath)},`,
  );

  return `export const ${functionName} = (arrayIndex: string = '', overrides?: Partial<AliasTypes.${type.aliasName}>): AliasTypes.${type.aliasName} => {
  return {
    __typename: '${type.typename}',
${fieldMockAssignments.join('\n')}
    ...overrides,
  };
};`;
};

// ============================================================================
// Dependency-Ordered Sorting (Topological Sort)
// ============================================================================

/**
 * Sort types so that dependencies come before the types that reference them.
 *
 * This is necessary because mock functions call other mock functions:
 *   `fake_Messages` calls `fake_Messages_Author` for the `author` field.
 *
 * We need to define `fake_Messages_Author` before `fake_Messages` in the output file,
 * otherwise TypeScript will complain about using a function before it's defined.
 *
 * Uses a recursive approach: repeatedly find types whose dependencies are all satisfied,
 * add them to the result, and repeat until all types are processed.
 */
const sortTypesByDependencyOrder = (types: ParsedType[]): ParsedType[] => {
  /** Get all alias names that this type depends on (references in its fields) */
  const getTypeDependencies = (type: ParsedType): string[] =>
    type.fields.filter(field => field.referencedType).map(field => field.referencedType as string);

  /**
   * Recursive sort step: partition types into ready (all deps satisfied) and not ready,
   * add ready types to result, and recurse with remaining types.
   */
  const processSortStep = (
    remainingTypes: ParsedType[],
    alreadyAddedAliases: Set<string>,
    sortedResult: ParsedType[],
  ): {
    remainingTypes: ParsedType[];
    alreadyAddedAliases: Set<string>;
    sortedResult: ParsedType[];
  } => {
    const [typesReadyToAdd, typesNotReady] = remainingTypes.reduce<[ParsedType[], ParsedType[]]>(
      ([ready, notReady], type) => {
        const allDependenciesSatisfied = getTypeDependencies(type).every(dep =>
          alreadyAddedAliases.has(dep),
        );
        return allDependenciesSatisfied
          ? [[...ready, type], notReady]
          : [ready, [...notReady, type]];
      },
      [[], []],
    );

    // No progress means we have circular dependencies - stop recursion
    if (typesReadyToAdd.length === 0) {
      return { remainingTypes, alreadyAddedAliases, sortedResult };
    }

    const newlyAddedAliases = new Set([
      ...alreadyAddedAliases,
      ...typesReadyToAdd.map(t => t.aliasName),
    ]);
    return processSortStep(typesNotReady, newlyAddedAliases, [...sortedResult, ...typesReadyToAdd]);
  };

  const { sortedResult, remainingTypes: circularDependencies } = processSortStep(
    types,
    new Set(),
    [],
  );

  // Any remaining types have circular dependencies - append them at the end
  // (they'll work at runtime, just might have TypeScript warnings)
  return [...sortedResult, ...circularDependencies];
};

// ============================================================================
// Mocks File Generation
// ============================================================================

/**
 * Generate the content for a .fakes.ts file.
 *
 * Creates fake_* factory functions for each type that return properly typed mock data.
 * Functions are ordered so dependencies come first (leaf types before types that reference them).
 */
const generateMocksFileContent = (parsedTypes: ParsedType[], aliasesFileName: string): string => {
  const fileHeader = [
    `// This file is auto-generated by generateMocksForDomains, do not edit manually`,
    `import * as Types from './base-types';`,
    `import type * as AliasTypes from './${aliasesFileName}';`,
    ``,
  ];

  const typesSortedByDependencies = sortTypesByDependencyOrder(parsedTypes);
  const mockFunctionDefinitions = typesSortedByDependencies.map(
    type => generateMockFactoryFunction(type) + '\n',
  );

  return [...fileHeader, ...mockFunctionDefinitions].join('\n');
};

// ============================================================================
// File Processing
// ============================================================================

/**
 * Process a single .types.ts file and generate corresponding .aliases.ts and .fakes.ts files.
 */
const processTypesFile = (typesFilePath: string, project: Project): void => {
  const parsedTypes = parseTypesFile(typesFilePath, project);
  if (parsedTypes.length === 0) return;

  const outputDirectory = dirname(typesFilePath);
  const typesFileName = basename(typesFilePath, '.ts');
  const aliasesFileName = typesFileName.replace('.types', '.aliases');
  const fakesFileName = typesFileName.replace('.types', '.fakes');

  const aliasesFilePath = join(outputDirectory, `${aliasesFileName}.ts`);
  const fakesFilePath = join(outputDirectory, `${fakesFileName}.ts`);

  writeFileSync(aliasesFilePath, generateAliasesFileContent(parsedTypes, typesFileName), {
    encoding: 'utf-8',
  });
  writeFileSync(fakesFilePath, generateMocksFileContent(parsedTypes, aliasesFileName), {
    encoding: 'utf-8',
  });

  console.log(`Generated ${aliasesFileName}.ts and ${fakesFileName}.ts for ${typesFileName}.ts`);
};

// ============================================================================
// Main Entry Point
// ============================================================================

/** Check if a file path is a .types.ts file in the implicit/docent domain */
const isImplicitDocentTypesFile = (filePath: string): boolean =>
  filePath.includes('libs/implicit/docent/') &&
  filePath.endsWith('.types.ts') &&
  filePath.includes('/generated/');

/**
 * Main entry point - processes all .types.ts files in implicit/docent domains.
 *
 * Called from the afterAllFileWrite hook in codegen.ts after typescript-operations
 * has generated the verbose .types.ts files.
 *
 * For each .types.ts file, generates:
 * - .aliases.ts: Clean type aliases mapping to the verbose types
 * - .fakes.ts: Factory functions for creating mock data in tests
 */
export const generateMocksForDomains = (filePaths: string[]): void => {
  const project = new Project();

  const implicitDocentTypesFiles = filePaths.filter(isImplicitDocentTypesFile);

  implicitDocentTypesFiles.forEach(typesFilePath => {
    try {
      processTypesFile(typesFilePath, project);
    } catch (error) {
      console.error(`Error processing ${typesFilePath}:`, error);
    }
  });
};
