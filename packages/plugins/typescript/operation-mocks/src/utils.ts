/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a context path to camelCase for function names
 * e.g., "messages.replyTo.author" → "messages_replyTo_author"
 */
export function contextToCamelCase(contextPath: string): string {
  const parts = contextPath.split('.').filter(part => part !== '');
  if (parts.length === 0) return '';

  // First part lowercase, rest camelCase
  const camelParts = parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    return part.charAt(0).toLowerCase() + part.slice(1);
  });

  return camelParts.join('_');
}

/**
 * Convert a context path to PascalCase for interface names
 * e.g., "messages.replyTo.author" → "Messages_ReplyTo_Author"
 */
export function contextToPascalCase(contextPath: string): string {
  const parts = contextPath.split('.').filter(part => part !== '');
  if (parts.length === 0) return '';

  const pascalParts = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1));

  return '_' + pascalParts.join('_');
}

/**
 * Unwraps GraphQL type wrappers (NonNull, List) to get the base type.
 *
 * EXAMPLE: String! → String, [User!]! → User
 */
export function getBaseType(type: any): any {
  return type.ofType ? getBaseType(type.ofType) : type;
}

/**
 * Returns appropriate mock values for GraphQL scalar types.
 */
export function getPrimitiveMockValue(typeName: string, fieldName: string): string {
  switch (typeName) {
    case 'String':
      return `'${fieldName}'`;
    case 'Int':
      return '42';
    case 'Float':
      return '3.14';
    case 'Boolean':
      return 'true';
    case 'ID':
      return `'${fieldName}-id'`;
    default:
      return `'${fieldName}'`; // fallback for custom scalars
  }
}

/**
 * Returns appropriate mock values for custom scalar types based on their configured TypeScript type.
 */
export function getScalarMockValue(scalarType: string, fieldName: string): string {
  // Handle common TypeScript types
  if (scalarType === 'Date') {
    return 'new Date()';
  }
  if (scalarType === 'string') {
    return `'${fieldName}'`;
  }
  if (scalarType === 'number') {
    return '1';
  }
  if (scalarType === 'boolean') {
    return 'true';
  }

  // For other types, try to construct with new if it looks like a class/constructor
  if (scalarType.match(/^[A-Z][a-zA-Z0-9]*$/)) {
    return `new ${scalarType}()`;
  }

  // For primitive or unknown types, use string fallback
  return `'${fieldName}'`;
}
