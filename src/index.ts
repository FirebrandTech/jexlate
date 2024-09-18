import jexl from 'jexl';
import Expression from 'jexl/Expression';
import { Transform, TransformCallback } from 'node:stream';

// Define a type for individual fields in the template
export type TemplateField = {
  from: string | Expression;
  if?: string | Expression;
  required?: boolean;
  as?: 'string' | 'number' | 'boolean' | 'json';
  raw?: Record<string, string>;
};

// Define a type for arrays in the template
export type TemplateArray = {
  from: string; // Must contain '[]' to indicate an array
  values: TemplateMapping; // The structure for each item in the array
  raw: Record<string, string>;
  if?: string | Expression;
};

// Define a type for objects (nested fields) in the template
export type TemplateObject = {
  [key: string]: TemplateMapping;
};

// Combine the types into a single type for the template
export type TemplateMapping = TemplateField | TemplateArray | TemplateObject;

// Helper type to infer the structure of the output
export type InferOutput<T> = T extends TemplateField
  ? any
  : T extends TemplateArray
    ? InferOutput<T['values']>[]
    : T extends TemplateObject
      ? { [K in keyof T]: InferOutput<T[K]> }
      : T;

export type JexlateFunction = Record<
  string,
  (value: any, ...args: any[]) => any
>;
export type JexlateTransform = Record<
  string,
  (value: any, ...args: any[]) => any
>;
export type JexlateBinaryOp = Record<
  string,
  {
    precedence: number;
    fn: (left: any, right: any) => any;
  }
>;
export interface JexlateConfig {
  transforms?: JexlateFunction;
  functions?: JexlateTransform;
  binaryOps?: JexlateBinaryOp;
}

export class Jexlate<T extends TemplateMapping> {
  private template: T;
  private requiredCollector: string[];

  constructor(template: T, config?: JexlateConfig) {
    const { transforms, functions, binaryOps } = config || {};

    this.requiredCollector = [];

    // Add custom functions to Jexl
    if (functions) {
      for (const fn in functions) {
        jexl.addFunction(fn, functions[fn]);
      }
    }

    // Add custom transforms to Jexl
    if (transforms) {
      for (const transform in transforms) {
        jexl.addTransform(transform, transforms[transform]);
      }
    }

    // Add custom binary operators to Jexl
    if (binaryOps) {
      for (const operator in binaryOps) {
        jexl.addBinaryOp(
          operator,
          binaryOps[operator].precedence,
          binaryOps[operator].fn
        );
      }
    }

    // Compile the template expressions (from and if) for better performance
    this.template = this.compileTemplate(template as TemplateMapping) as T;
  }

  private compileTemplate(template: TemplateMapping): TemplateMapping {
    // Ensure template is an object before trying to access properties
    if (typeof template === 'object' && template !== null) {
      if ('from' in template && typeof template.from === 'string') {
        // Store the original 'from' string before compiling
        const originalFrom = template.from;
        template.raw = {
          ...(template.raw || {}),
          from: originalFrom,
        };

        // Compile the 'from' expression
        template.from = jexl.compile(originalFrom);
      }

      if ('if' in template && typeof template.if === 'string') {
        // Store the original 'if' string before compiling
        const originalIf = template.if;
        template.raw = {
          ...(template.raw || {}),
          if: originalIf,
        };

        // Compile the 'if' expression
        template.if = jexl.compile(originalIf);
      }

      // Recursively compile values for arrays
      if ('values' in template && typeof template.values === 'object') {
        template.values = this.compileTemplate(template.values);
      }

      // Recursively compile each key in the object (skip raw)
      for (const key in template) {
        if (template.hasOwnProperty(key) && key !== 'raw') {
          // Only compile properties other than 'raw' to avoid reprocessing
          template[key] = this.compileTemplate(template[key]);
        }
      }
    }

    return template;
  }

  public parse(data: any): InferOutput<T> {
    const result = this.transform(this.template, data);

    // Check if required fields are missing or invalid
    if (this.requiredCollector.length > 0) {
      throw new Error(
        `Required fields are missing or invalid: ${this.requiredCollector.join(', ')}`
      );
    }

    return result;
  }

  private transformObject(
    template: TemplateObject,
    data: any,
    path: string = ''
  ): any {
    const obj: any = {};
    for (const key in template) {
      const templateEntry = template[key];
      const result = this.transform(
        templateEntry,
        data,
        path ? `${path}.${key}` : key
      );

      // Only add to the result if the result is not undefined
      if (result !== undefined) {
        obj[key] = result;
      }
    }
    return obj;
  }

  private transformArray(
    template: TemplateArray,
    data: Record<string, any>,
    path: string
  ): any {
    // Use the raw 'from' field to get the array key
    const arrayKey = template.raw?.from.replace('[]', '');

    // Get the array data from the input
    const arrayData = data[arrayKey];

    if (!Array.isArray(arrayData)) {
      throw new Error(
        `Expected an array for key "${arrayKey}" but got: ${typeof arrayData}`
      );
    }

    const arr: any[] = [];

    // Loop through each item in the array and transform it
    for (const item of arrayData) {
      arr.push(this.transform(template.values, item, path));
    }

    return arr;
  }

  private transformField(
    template: TemplateField,
    data: any,
    path: string
  ): any {
    try {
      // Use raw.from for literals and error messages
      const expressionString = template.raw?.from || '';

      // Handle literal expressions before any Jexl evaluation
      const valueMatch = expressionString.match(/^value\((.*)\)$/);
      if (valueMatch) {
        return this.coerceType(valueMatch[1], template.as); // Handle 'value(foo)'
      }

      const stringMatch = expressionString.match(/^string\((.*)\)$/);
      if (stringMatch) {
        return String(stringMatch[1]); // Handle 'string(foo)'
      }

      const numberMatch = expressionString.match(/^number\((.*)\)$/);
      if (numberMatch) {
        return Number(numberMatch[1]); // Handle 'number(42)'
      }

      const booleanMatch = expressionString.match(/^boolean\((true|false)\)$/);
      if (booleanMatch) {
        return booleanMatch[1] === 'true'; // Handle 'boolean(true)' or 'boolean(false)'
      }

      if (expressionString === 'null()') {
        return null; // Handle 'null()'
      }

      // Evaluate the 'if' condition if it exists (compiled or string)
      if (template.if) {
        const condition =
          typeof template.if === 'object'
            ? template.if.evalSync(data) // Compiled expression
            : jexl.evalSync(template.if, data); // String expression
        if (!condition) {
          // Skip the field if 'if' condition is false and not required
          if (template.required) {
            this.requiredCollector.push(path ? `${path}` : 'unknown');
          }
          return undefined; // Skip the field
        }
      }

      // Evaluate the 'from' expression (either compiled or string)
      const dataToEvaluate =
        typeof template.from === 'object'
          ? template.from.evalSync(data) // Compiled expression
          : jexl.evalSync(template.from, data); // String expression

      if (dataToEvaluate === null || dataToEvaluate === undefined) {
        if (template.required) {
          this.requiredCollector.push(path ? `${path}` : 'unknown');
        }
        return undefined; // Skip if data is null/undefined
      }

      // Coerce the type based on the 'as' property
      return this.coerceType(dataToEvaluate, template.as);
    } catch (e) {
      throw new Error(
        `Failed to evaluate expression: ${template.raw?.from || '[unknown]'}. Error: ${e.message}`
      );
    }
  }

  private coerceType(
    value: any,
    type?: 'string' | 'number' | 'boolean' | 'json'
  ): any {
    if (type) {
      // If a specific type is requested, coerce to that type
      if (type === 'string') return String(value);
      if (type === 'number')
        return isNaN(Number(value)) ? value : Number(value);
      if (type === 'boolean') return value === 'true' || value === true;
      if (type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          throw new Error(`Cannot coerce value "${value}" to JSON`);
        }
      }
    }

    // Automatic coercion based on value format
    if (typeof value === 'string') {
      // Coerce to number if it looks like a number
      if (!isNaN(Number(value))) return Number(value);

      // Coerce to boolean if it's 'true' or 'false'
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;

      // Coerce to null if it's 'null'
      if (value.toLowerCase() === 'null') return null;
    }

    // Return the value unchanged if no coercion is applied
    return value;
  }

  private transform(
    template: TemplateArray | TemplateObject | TemplateField,
    data: any,
    path: string = ''
  ): any {
    // Check if template is an object and has a 'from' field
    if (typeof template === 'object' && template.raw?.from) {
      // Check for array notation '[]' in the raw 'from' field
      if (template.raw.from.toString().includes('[]')) {
        if ('values' in template) {
          // Handle arrays using the 'transformArray' method
          return this.transformArray(template as TemplateArray, data, path);
        } else {
          throw new Error(`Invalid template: ${JSON.stringify(template)}`);
        }
      }
      // Handle regular field transformations
      return this.transformField(template as TemplateField, data, path);
    } else if (typeof template === 'object') {
      // Handle nested objects
      return this.transformObject(template as TemplateObject, data, path);
    }

    // If the template isn't an object or array, return it unchanged
    return template;
  }

  public stream(): JexlateTransformStream {
    return new JexlateTransformStream(this);
  }
}

class JexlateTransformStream extends Transform {
  private Jexlate: Jexlate<TemplateMapping>;

  constructor(Jexlate: Jexlate<TemplateMapping>) {
    super({ objectMode: true });
    this.Jexlate = Jexlate;
  }

  _transform(chunk: any, encoding: string, callback: TransformCallback) {
    this.push(this.Jexlate.parse(chunk));
    callback();
  }
}
