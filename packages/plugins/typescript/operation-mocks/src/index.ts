import {
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  GraphQLSchema,
  isEnumType,
  isNonNullType,
  isObjectType,
  Kind,
  OperationDefinitionNode,
} from 'graphql';
import { PluginFunction, Types } from '@graphql-codegen/plugin-helpers';
import {
  buildScalarsFromConfig,
  DeclarationBlock,
  DEFAULT_SCALARS,
  indent,
  ParsedEnumValuesMap,
  ParsedScalarsMap,
  parseEnumValues,
  transformComment,
  wrapWithSingleQuotes,
} from '@graphql-codegen/visitor-plugin-common';
import {
  capitalize,
  contextToCamelCase,
  contextToPascalCase,
  getBaseType,
  getPrimitiveMockValue,
  getScalarMockValue,
} from './utils.js';

/**
 * Represents a loaded fragment definition
 */
interface LoadedFragment {
  name: string;
  onType: string;
  node: FragmentDefinitionNode;
}

/**
 * Configuration options for the TypeScript Operation Mocks plugin
 */
export interface OperationMocksPluginConfig {
  /**
   * @description Generate mock functions using the fake${QueryName}${SchemaType} naming pattern.
   * These functions return objects with only the fields selected in your GraphQL operations.
   * @default true
   * @example fakeGetMessagesMessage(), fakeGetMessagesAuthor()
   */
  generateMocks?: boolean;

  /**
   * @description Generate TypeScript interfaces for selected fields only.
   * Creates interfaces like GetMessages_Message with only the fields you actually query.
   * Similar to extractAllFieldsToTypes in typescript-operations plugin.
   * @default false
   * @example GetMessages_Message { id: string; author: GetMessages_Author; }
   */
  generateQueryTypes?: boolean;

  /**
   * @description Path to import schema types from.
   * @default '../types'
   */
  typesFile?: string;

  /**
   * @description Path to import generated query-specific types from when generateQueryTypes is enabled.
   * @default './_query-types'
   */
  queryTypesFile?: string;

  /**
   * @description Allows you to override the default scalar mappings.
   * @default { Date: 'Date' }
   */
  scalars?: any;

  /**
   * @description Allows you to override enum values mapping.
   */
  enumValues?: any;

  /**
   * @description Generates enum as TypeScript `const assertions` instead of `enum`.
   * This generates `export const TYPE = { COMMENT: 'COMMENT' } as const` instead of regular enums.
   * @default false
   */
  enumsAsConst?: boolean;
}

// Interface to track what fields are selected for each type with context path
interface TypeFieldSelection {
  typeName: string;
  contextPath: string; // e.g., "Message", "Message.replyTo", "Message.replyTo.author"
  selectedFields: Set<string>;
}

/**
 * GraphQL Code Generator plugin that creates mock functions for operations.
 *
 * WHAT IT DOES:
 * - Analyzes your GraphQL operations (queries/mutations/subscriptions)
 * - Generates mock functions with the pattern: a{OperationName}{TypeName}
 * - Only includes fields that are actually selected in your operations
 * - Optionally generates TypeScript interfaces for field-specific types
 *
 * EXAMPLE:
 * For a query "GetMessages" selecting { id, author { name } }:
 * - Generates: fakeGetMessagesMessage() → { id: 'id', author: fakeGetMessagesAuthor() }
 * - Generates: fakeGetMessagesAuthor() → { name: 'name' }
 */
export const plugin: PluginFunction<OperationMocksPluginConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: OperationMocksPluginConfig,
): string => {
  // Apply defaults to configuration
  const shouldGenerateMocks = config.generateMocks !== false; // default: true
  const shouldGenerateTypes = config.generateQueryTypes === true; // default: false

  // Build scalars and enums configuration
  let scalarsMap: ParsedScalarsMap = {};
  let enumValuesMap: ParsedEnumValuesMap = {};

  scalarsMap = buildScalarsFromConfig(schema, config, DEFAULT_SCALARS);
  enumValuesMap = parseEnumValues({
    schema,
    mapOrStr: config.enumValues || {},
  });

  // Collect all fragment definitions from all documents
  const allFragments: LoadedFragment[] = documents
    .filter(doc => doc.document)
    .flatMap(
      doc =>
        doc.document!.definitions.filter(
          d => d.kind === Kind.FRAGMENT_DEFINITION,
        ) as FragmentDefinitionNode[],
    )
    .map(fragmentDef => ({
      name: fragmentDef.name.value,
      onType: fragmentDef.typeCondition.name.value,
      node: fragmentDef,
    }));

  // Generate only TypeScript interfaces when mocks are disabled
  if (shouldGenerateTypes && !shouldGenerateMocks) {
    return generateQueryTypes_impl(
      schema,
      documents,
      allFragments,
      scalarsMap,
      enumValuesMap,
      config.enumsAsConst,
    );
  }

  // Generate mock functions (with optional generated type usage)
  return generateOperationMocks(
    schema,
    documents,
    config.typesFile,
    shouldGenerateTypes,
    allFragments,
    config.queryTypesFile,
    scalarsMap,
    enumValuesMap,
    config.enumsAsConst,
  );
};

/**
 * Generate enum definitions for GraphQL enums in the schema
 */
function generateEnumDefinitions(
  schema: GraphQLSchema,
  enumValuesMap: ParsedEnumValuesMap,
  enumsAsConst = false,
): string {
  const typeMap = schema.getTypeMap();
  const enumDefinitions: string[] = [];

  Object.values(typeMap).forEach(type => {
    if (isEnumType(type) && !type.name.startsWith('__')) {
      const enumName = type.name;

      // Skip if external enum mapping is provided
      if (enumValuesMap[enumName]?.sourceFile) {
        return;
      }

      const enumValues = type
        .getValues()
        .map(value => {
          const configValue = enumValuesMap[enumName]?.mappedValues?.[value.name];
          const enumValue = configValue !== undefined ? configValue : value.name;
          const comment = value.description ? transformComment(value.description, 1) : '';

          if (enumsAsConst) {
            // For const enums: KEY: 'VALUE'
            return comment + indent(`${value.name}: ${wrapWithSingleQuotes(enumValue)}`);
          } else {
            // For regular enums: KEY = 'VALUE'
            return comment + indent(`${value.name} = ${wrapWithSingleQuotes(enumValue)}`);
          }
        })
        .join(',\n');

      if (enumsAsConst) {
        // Generate const enum: export const TYPE = { ... } as const; export type TYPE = typeof TYPE[keyof typeof TYPE];
        const constDeclaration = new DeclarationBlock({
          blockTransformer: block => block + ' as const',
        })
          .export()
          .asKind('const')
          .withName(enumName)
          .withComment(type.description || undefined)
          .withBlock(enumValues).string;

        const typeDeclaration = `export type ${enumName} = typeof ${enumName}[keyof typeof ${enumName}];`;

        enumDefinitions.push([constDeclaration, typeDeclaration].join('\n'));
      } else {
        // Generate regular enum
        const enumDefinition = new DeclarationBlock({})
          .export()
          .asKind('enum')
          .withName(enumName)
          .withComment(type.description || undefined)
          .withBlock(enumValues).string;

        enumDefinitions.push(enumDefinition);
      }
    }
  });

  return enumDefinitions.join('\n\n');
}

/**
 * Generate scalar definitions similar to the main TypeScript plugin
 */
function generateScalarDefinitions(scalarsMap: ParsedScalarsMap): string {
  const allScalars = Object.keys(scalarsMap)
    .map(scalarName => {
      const scalarConfig = scalarsMap[scalarName];
      if (!scalarConfig) {
        console.warn(`Scalar ${scalarName} is missing configuration, skipping`);
        return null;
      }

      // ParsedScalarsMap contains ParsedMapper objects with input/output structure
      const scalarType = (scalarConfig as any).output?.type || scalarConfig.type || 'any';

      return indent(`${scalarName}: { input: ${scalarType}; output: ${scalarType}; }`);
    })
    .filter(Boolean);

  if (allScalars.length === 0) {
    return '';
  }

  return new DeclarationBlock({})
    .export()
    .asKind('type')
    .withName('Scalars')
    .withComment('All built-in and custom scalars, mapped to their actual values')
    .withBlock(allScalars.join('\n')).string;
}

// Interface to track what fields are selected for each type with context path
interface TypeFieldSelection {
  typeName: string;
  contextPath: string; // e.g., "Message", "Message.replyTo", "Message.replyTo.author"
  selectedFields: Set<string>;
}
function generateMockFieldValue(
  schema: GraphQLSchema,
  typeName: string,
  fieldName: string,
  operationName: string,
  allTypeSelections: TypeFieldSelection[],
  currentContextPath: string,
  hasSingleRoot: boolean,
  rootFieldName?: string,
  scalarsMap?: ParsedScalarsMap,
  enumValuesMap?: ParsedEnumValuesMap,
): string {
  const schemaType = schema.getType(typeName);

  // Safety check: ensure we have a valid object type
  if (!schemaType || !isObjectType(schemaType)) {
    return `    ${fieldName}: '${fieldName}'`; // fallback
  }

  const fieldDef = schemaType.getFields()[fieldName];

  // Handle special __typename field
  if (fieldName === '__typename') {
    return `    ${fieldName}: '${typeName}'`;
  }

  if (!fieldDef) {
    return `    ${fieldName}: '${fieldName}'`; // fallback
  }

  const baseType = getBaseType(fieldDef.type);
  const referencedTypeName = baseType.name;

  // Build the context path for this field

  // Build the context path for this field
  const fieldContextPath = currentContextPath ? `${currentContextPath}.${fieldName}` : fieldName;

  // Check if this field references another object type that we have a mock for
  const referencedTypeSelection = allTypeSelections.find(
    selection =>
      selection.typeName === referencedTypeName && selection.contextPath === fieldContextPath,
  );

  if (referencedTypeSelection && isObjectType(baseType)) {
    // Adjust context path for single root field operations
    let adjustedContextPath = referencedTypeSelection.contextPath;
    if (hasSingleRoot && rootFieldName && adjustedContextPath.startsWith(rootFieldName)) {
      adjustedContextPath =
        adjustedContextPath === rootFieldName
          ? ''
          : adjustedContextPath.substring(rootFieldName.length + 1);
    }

    // Create the mock function name for the referenced type using new naming pattern
    const contextSuffix = contextToCamelCase(adjustedContextPath);
    const referencedFunctionName = contextSuffix
      ? `fake_${operationName}_${contextSuffix}`
      : `fake_${operationName}`;

    return `    ${fieldName}: ${referencedFunctionName}()`;
  }

  // Check if this is an enum type
  if (isEnumType(baseType)) {
    // Get the first enum value as a default
    const enumValues = baseType.getValues();
    if (enumValues.length > 0) {
      const firstValue = enumValues[0].value;
      // Always use string literal for enum values to maintain type-only imports
      return `    ${fieldName}: '${firstValue}'`;
    }
  }

  // Handle scalar types (both built-in and custom)
  // First check for custom scalars
  if (scalarsMap && scalarsMap[baseType.name]) {
    const scalarConfig = scalarsMap[baseType.name];
    const scalarType = (scalarConfig as any).output?.type || scalarConfig.type || 'any';
    const customMockValue = getScalarMockValue(scalarType, fieldName);
    return `    ${fieldName}: ${customMockValue}`;
  }

  // Then handle built-in GraphQL scalars
  const mockValue = getPrimitiveMockValue(baseType.name, fieldName);
  return `    ${fieldName}: ${mockValue}`;
}

/**
 * Generates mock functions for GraphQL operations.
 *
 * PROCESS:
 * 1. Add necessary imports (schema types and/or generated query types)
 * 2. For each operation, find all selected types and fields
 * 3. Generate a mock function for each type with realistic mock data
 * 4. Handle nested objects by calling other mock functions
 */
function generateOperationMocks(
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  typesFile?: string,
  useGeneratedTypes?: boolean,
  allFragments: LoadedFragment[] = [],
  queryTypesFile?: string,
  scalarsMap?: ParsedScalarsMap,
  enumValuesMap?: ParsedEnumValuesMap,
  enumsAsConst = false,
): string {
  const mockFunctions: string[] = [];

  // Do not generate enum/scalar definitions in mocks - they should only be in query types

  // Import schema types when using custom types file (not preset)
  if (typesFile) {
    mockFunctions.push(`import * as Types from '${typesFile}';`, '');
  }

  // Import generated query-specific types when enabled
  if (useGeneratedTypes) {
    const queryTypesPath = queryTypesFile || './_query-types';
    mockFunctions.push(`import type * as QueryTypes from '${queryTypesPath}';`, '');
  }

  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = capitalize(operation.name!.value);
          const typeSelections = findTypeSelections(schema, operation, allFragments);

          // Check if operation has only one root field to adjust context paths
          const { isSingle: hasSingleRoot, rootFieldName } = hasSingleRootField(operation);

          // Create a mock function for each type and its selected fields
          typeSelections.forEach(typeSelection => {
            // Adjust context path for single root field operations
            let adjustedContextPath = typeSelection.contextPath;
            if (hasSingleRoot && rootFieldName && adjustedContextPath.startsWith(rootFieldName)) {
              // Remove the root field from the context path for single root operations
              adjustedContextPath =
                adjustedContextPath === rootFieldName
                  ? ''
                  : adjustedContextPath.substring(rootFieldName.length + 1);
            }

            // Create function name: fake_${queryname}_${contexts}
            const contextSuffix = contextToCamelCase(adjustedContextPath);
            const functionName = contextSuffix
              ? `fake_${operationName}_${contextSuffix}`
              : `fake_${operationName}`;

            // Use generated interface name if useGeneratedTypes is true
            const operationType = operation.operation;
            const basePrefix = operationType.charAt(0).toUpperCase() + operationType.slice(1);
            const interfaceName = useGeneratedTypes
              ? `QueryTypes.${basePrefix}_${operationName}${contextToPascalCase(adjustedContextPath)}`
              : typeSelection.typeName;

            // Generate mock data for each selected field with appropriate types
            const mockFields = Array.from(typeSelection.selectedFields)
              .map(field =>
                generateMockFieldValue(
                  schema,
                  typeSelection.typeName,
                  field,
                  operationName,
                  typeSelections,
                  typeSelection.contextPath,
                  hasSingleRoot,
                  rootFieldName,
                  scalarsMap,
                  enumValuesMap,
                ),
              )
              .filter(field => field.trim().length > 0) // Remove empty fields
              .join(',\n');

            const mockFunction = `export const ${functionName} = (overrides?: Partial<${interfaceName}>): ${interfaceName} => {
  return {
${mockFields ? mockFields + ',' : ''}
    ...overrides,
  };
};`;

            mockFunctions.push(mockFunction);
          });
        });
    });

  return mockFunctions.join('\n');
}

/**
 * Generates TypeScript interfaces for operation-specific field selections.
 *
 * PURPOSE:
 * Instead of using full schema types, create interfaces with only the fields
 * that are actually selected in your GraphQL operations.
 *
 * EXAMPLE:
 * Query: { user { id, name, profile { bio } } }
 * Generates: GetUser_User { id: string; name: string; profile: GetUser_Profile; }
 *            GetUser_Profile { bio: string; }
 *
 * PROCESS:
 * 1. First pass: Collect all type selections across all operations
 * 2. Second pass: Generate interfaces with proper cross-references
 */
function generateQueryTypes_impl(
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  allFragments: LoadedFragment[] = [],
  scalarsMap?: ParsedScalarsMap,
  enumValuesMap?: ParsedEnumValuesMap,
  enumsAsConst = false,
): string {
  const typeInterfaces: string[] = [];
  const generatedTypes = new Set<string>(); // Track generated interfaces to avoid duplicates

  // Generate enum definitions first if we have enums
  if (enumValuesMap) {
    const enumDefinitions = generateEnumDefinitions(schema, enumValuesMap, enumsAsConst);
    if (enumDefinitions) {
      typeInterfaces.push(enumDefinitions, '');
    }
  }

  // Generate scalar definitions if we have scalars
  if (scalarsMap) {
    const scalarDefinitions = generateScalarDefinitions(scalarsMap);
    if (scalarDefinitions) {
      typeInterfaces.push(scalarDefinitions, '');
    }
  }

  // FIRST PASS: Map all operation types to their selected fields
  const allTypeSelections = new Map<string, Set<string>>();

  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = capitalize(operation.name!.value);
          const typeSelections = findTypeSelections(schema, operation, allFragments);

          // Check if operation has only one root field to adjust context paths
          const { isSingle: hasSingleRoot, rootFieldName } = hasSingleRootField(operation);

          typeSelections.forEach(typeSelection => {
            // Adjust context path for single root field operations
            let adjustedContextPath = typeSelection.contextPath;
            if (hasSingleRoot && rootFieldName && adjustedContextPath.startsWith(rootFieldName)) {
              // Remove the root field from the context path for single root operations
              adjustedContextPath =
                adjustedContextPath === rootFieldName
                  ? ''
                  : adjustedContextPath.substring(rootFieldName.length + 1);
            }

            // Create interface name: ${base}_${queryname}_${context}
            const operationType = operation.operation; // 'query', 'mutation', 'subscription'
            const basePrefix = operationType.charAt(0).toUpperCase() + operationType.slice(1); // 'Query', 'Mutation', 'Subscription'

            const interfaceName = `${basePrefix}_${operationName}${contextToPascalCase(adjustedContextPath)}`;

            allTypeSelections.set(interfaceName, typeSelection.selectedFields);
          });
        });
    });

  // Second pass: generate interfaces with proper type references
  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = capitalize(operation.name!.value);
          const typeSelections = findTypeSelections(schema, operation, allFragments);

          // Check if operation has only one root field to adjust context paths
          const { isSingle: hasSingleRoot, rootFieldName } = hasSingleRootField(operation);

          // Create TypeScript interfaces for each type with selected fields
          typeSelections.forEach(typeSelection => {
            // Adjust context path for single root field operations
            let adjustedContextPath = typeSelection.contextPath;
            if (hasSingleRoot && rootFieldName && adjustedContextPath.startsWith(rootFieldName)) {
              // Remove the root field from the context path for single root operations
              adjustedContextPath =
                adjustedContextPath === rootFieldName
                  ? ''
                  : adjustedContextPath.substring(rootFieldName.length + 1);
            }

            // Create interface name: ${base}_${queryname}_${context}
            const operationType = operation.operation; // 'query', 'mutation', 'subscription'
            const basePrefix = operationType.charAt(0).toUpperCase() + operationType.slice(1); // 'Query', 'Mutation', 'Subscription'

            const interfaceName = `${basePrefix}_${operationName}${contextToPascalCase(adjustedContextPath)}`;

            if (!generatedTypes.has(interfaceName)) {
              generatedTypes.add(interfaceName);

              // Generate interface with only selected fields
              const interfaceFields = Array.from(typeSelection.selectedFields)
                .map(field => {
                  // Handle special __typename field first
                  if (field === '__typename') {
                    return `  ${field}: '${typeSelection.typeName}';`;
                  }

                  // Get the field type from the schema
                  const schemaType = schema.getType(typeSelection.typeName);
                  if (schemaType && isObjectType(schemaType)) {
                    const fieldDef = schemaType.getFields()[field];
                    if (fieldDef) {
                      const baseType = getBaseType(fieldDef.type);
                      const isNullable = !isNonNullType(fieldDef.type); // Check if field is nullable

                      let fieldType = 'string'; // default fallback

                      // Handle scalar types
                      if (scalarsMap && scalarsMap[baseType.name]) {
                        // Check if it's a custom scalar (not a built-in GraphQL scalar)
                        if (['String', 'Int', 'Float', 'Boolean', 'ID'].includes(baseType.name)) {
                          // Use simple type for built-in scalars
                          if (baseType.name === 'String' || baseType.name === 'ID')
                            fieldType = 'string';
                          else if (baseType.name === 'Int' || baseType.name === 'Float')
                            fieldType = 'number';
                          else if (baseType.name === 'Boolean') fieldType = 'boolean';
                        } else {
                          // Use Scalars reference for custom scalars
                          fieldType = `Scalars['${baseType.name}']['output']`;
                        }
                      } else if (baseType.name === 'String') fieldType = 'string';
                      else if (baseType.name === 'Int' || baseType.name === 'Float')
                        fieldType = 'number';
                      else if (baseType.name === 'Boolean') fieldType = 'boolean';
                      else if (baseType.name === 'ID') fieldType = 'string';
                      else if (isEnumType(baseType)) {
                        // Handle enum types
                        fieldType = baseType.name;
                      } else {
                        // Check if this is an object type that we're generating an interface for
                        // Build the referenced interface name with proper context
                        const fieldContextPath = typeSelection.contextPath
                          ? `${typeSelection.contextPath}.${field}`
                          : field;

                        // Adjust context path for single root field operations
                        let adjustedFieldContextPath = fieldContextPath;
                        if (
                          hasSingleRoot &&
                          rootFieldName &&
                          adjustedFieldContextPath.startsWith(rootFieldName)
                        ) {
                          adjustedFieldContextPath =
                            adjustedFieldContextPath === rootFieldName
                              ? ''
                              : adjustedFieldContextPath.substring(rootFieldName.length + 1);
                        }

                        const referencedInterfaceName = `${basePrefix}_${operationName}${contextToPascalCase(adjustedFieldContextPath)}`;

                        if (allTypeSelections.has(referencedInterfaceName)) {
                          fieldType = referencedInterfaceName;
                        } else {
                          fieldType = baseType.name; // Use the schema type name as fallback
                        }
                      }

                      // Add null union type for nullable fields
                      if (isNullable) {
                        fieldType = `${fieldType} | null`;
                      }

                      return `  ${field}: ${fieldType};`;
                    }
                  }
                  return `  ${field}: any;`; // fallback
                })
                .join('\n');

              const interfaceDeclaration = `export interface ${interfaceName} {
${interfaceFields}
}`;

              typeInterfaces.push(interfaceDeclaration);
            }
          });
        });
    });

  return typeInterfaces.join('\n\n');
}

/**
 * Check if an operation has only one root field selection
 */
function hasSingleRootField(operation: OperationDefinitionNode): {
  isSingle: boolean;
  rootFieldName?: string;
} {
  const rootSelections = operation.selectionSet.selections.filter(
    selection => selection.kind === Kind.FIELD,
  );

  if (rootSelections.length === 1) {
    const rootField = rootSelections[0] as FieldNode;
    return { isSingle: true, rootFieldName: rootField.name.value };
  }

  return { isSingle: false };
}

/**
 * Analyzes a GraphQL operation to find all selected types and their fields.
 *
 * WHAT IT DOES:
 * - Traverses the operation's selection set (query/mutation/subscription)
 * - Identifies which GraphQL object types are referenced
 * - Tracks which specific fields are selected for each type
 * - Uses iterative approach (no recursion) for better performance
 *
 * EXAMPLE INPUT: query GetUser { user { id, profile { bio } } }
 * EXAMPLE OUTPUT: [
 *   { typeName: 'User', selectedFields: Set(['id', 'profile']) },
 *   { typeName: 'Profile', selectedFields: Set(['bio']) }
 * ]
 */
function findTypeSelections(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
  allFragments: LoadedFragment[] = [],
): TypeFieldSelection[] {
  const typeSelections = new Map<string, TypeFieldSelection>(); // Map by contextPath

  // Determine the root type based on operation kind
  const rootType = {
    query: schema.getQueryType(),
    mutation: schema.getMutationType(),
    subscription: schema.getSubscriptionType(),
  }[operation.operation];

  if (rootType) {
    // Process the operation using iterative traversal (more efficient than recursion)
    collectTypeSelectionsIteratively(
      operation.selectionSet.selections,
      typeSelections,
      rootType,
      '',
      allFragments,
    );
  }

  // Convert Map to TypeFieldSelection array
  return Array.from(typeSelections.values());
}

/**
 * Iteratively traverses GraphQL selections to collect type information.
 *
 * ALGORITHM:
 * - Uses breadth-first traversal with a processing queue
 * - Each level processes all current selections
 * - Collects nested selections for the next level
 * - Continues until no more nested selections exist
 *
 * WHY ITERATIVE:
 * - Avoids stack overflow on deeply nested queries
 * - Better performance than recursive approach
 * - Easier to debug and understand flow
 */
function collectTypeSelectionsIteratively(
  initialSelections: readonly any[],
  typeSelections: Map<string, TypeFieldSelection>,
  initialParentType: any,
  initialContextPath: string = '',
  allFragments: LoadedFragment[] = [],
) {
  // Queue of selections to process: [{ selections, parentType, contextPath }]
  let processingQueue = [
    {
      selections: initialSelections,
      parentType: initialParentType,
      contextPath: initialContextPath,
    },
  ];

  // Process queue until empty (breadth-first traversal)
  while (processingQueue.length > 0) {
    // Process current level and build next level queue
    processingQueue = processingQueue.flatMap(({ selections, parentType, contextPath }) => {
      const nextLevelItems: any[] = [];

      for (const selection of selections) {
        if (selection.kind === Kind.FIELD) {
          // Handle field selections
          const field = selection as FieldNode;
          if (isObjectType(parentType) && parentType.getFields()[field.name.value]) {
            const fieldDef = parentType.getFields()[field.name.value];
            const fieldType = getBaseType(fieldDef.type); // Unwrap NonNull/List wrappers

            // Track object types and their selected fields
            if (isObjectType(fieldType)) {
              const typeName = fieldType.name;
              const newContextPath = contextPath
                ? `${contextPath}.${field.name.value}`
                : field.name.value;
              const contextKey = `${typeName}@${newContextPath}`;

              // Initialize type selection for this context
              if (!typeSelections.has(contextKey)) {
                typeSelections.set(contextKey, {
                  typeName,
                  contextPath: newContextPath,
                  selectedFields: new Set(),
                });
              }

              // Process nested selections if they exist
              if (field.selectionSet) {
                // Record all selected fields for this type in this context
                field.selectionSet.selections
                  .filter(nestedSelection => nestedSelection.kind === Kind.FIELD)
                  .forEach(nestedSelection => {
                    const nestedField = nestedSelection as FieldNode;
                    typeSelections.get(contextKey)!.selectedFields.add(nestedField.name.value);
                  });

                // Also expand fragment spreads within field selection sets
                field.selectionSet.selections
                  .filter(nestedSelection => nestedSelection.kind === Kind.FRAGMENT_SPREAD)
                  .forEach(nestedSelection => {
                    const fragmentSpread = nestedSelection as FragmentSpreadNode;
                    const fragmentName = fragmentSpread.name.value;
                    const fragmentDef = allFragments.find(frag => frag.name === fragmentName);

                    if (fragmentDef && fragmentDef.onType === fieldType.name) {
                      // Add all fields from the fragment to the current type
                      fragmentDef.node.selectionSet.selections
                        .filter(fragSelection => fragSelection.kind === Kind.FIELD)
                        .forEach(fragSelection => {
                          const fragField = fragSelection as FieldNode;
                          typeSelections.get(contextKey)!.selectedFields.add(fragField.name.value);
                        });
                    }
                  });

                // Queue nested selections for next iteration
                nextLevelItems.push({
                  selections: field.selectionSet.selections,
                  parentType: fieldType,
                  contextPath: newContextPath,
                });
              }
            }
          }
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
          // Handle fragment spread selections
          const fragmentSpread = selection as FragmentSpreadNode;
          const fragmentName = fragmentSpread.name.value;

          // Find the fragment definition
          const fragmentDef = allFragments.find(frag => frag.name === fragmentName);
          if (fragmentDef && fragmentDef.onType === parentType.name) {
            // Add fragment selections to the current processing queue
            nextLevelItems.push({
              selections: fragmentDef.node.selectionSet.selections,
              parentType,
              contextPath,
            });
          }
        }
      }

      return nextLevelItems;
    });
  }

  // Convert Map to TypeFieldSelection array
  return Array.from(typeSelections.values());
}
