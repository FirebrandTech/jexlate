import jexl from 'jexl';
import { Transform, TransformCallback } from 'node:stream';

// Define a type for individual fields in the template
type TemplateField = {
  from: string;
  if?: string;
  required?: boolean;
  as?: 'string' | 'number' | 'boolean' | 'json';
};

// Define a type for arrays in the template
type TemplateArray = {
  from: string; // Must contain '[]' to indicate an array
  values: TemplateMapping; // The structure for each item in the array
};

// Define a type for objects (nested fields) in the template
type TemplateObject = {
  [key: string]: TemplateMapping;
};

// Combine the types into a single type for the template
type TemplateMapping = TemplateField | TemplateArray | TemplateObject;

// Helper type to infer the structure of the output
type InferOutput<T> = T extends TemplateField
  ? any
  : T extends TemplateArray
    ? InferOutput<T['values']>[]
    : T extends TemplateObject
      ? { [K in keyof T]: InferOutput<T[K]> }
      : T;

interface JexlateConfig {
  tranforms?: Record<string, (value: any, ...args: any[]) => any>;
  functions?: Record<string, (value: any, ...args: any[]) => any>;
  binaryOps?: Record<
    string,
    {
      precedence: number;
      fn: (left: any, right: any) => any;
    }
  >;
}

export class Jexlate<T extends TemplateMapping> {
  private template: T;
  private requiredCollector: string[];

  constructor(template: T, config?: JexlateConfig) {
    const { tranforms, functions, binaryOps } = config || {};
    this.template = template as T;
    this.requiredCollector = [];

    // Add custom functions to Jexl
    if (functions) {
      for (const fn in functions) {
        jexl.addFunction(fn, functions[fn]);
      }
    }

    // Add custom transforms to Jexl
    if (tranforms) {
      for (const transform in tranforms) {
        jexl.addTransform(transform, tranforms[transform]);
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
  }

  parse(data: any): InferOutput<T> {
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
    const arrayKey = template.from.replace('[]', ''); // Strip out `[]` to get the array key
    const arrayData = data[arrayKey]; // Directly access the array in the data object

    if (!Array.isArray(arrayData)) {
      throw new Error(`Expected an array but got: ${typeof arrayData}`);
    }

    const arr: any[] = [];
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
      // Handle the case where the 'from' field uses the 'value(foo)' syntax
      const valueMatch = template.from.match(/^value\((.*)\)$/);
      if (valueMatch) {
        return this.coerceType(valueMatch[1], template.as); // Coerce the value inside parentheses
      }

      // Handle the case where the 'from' field uses the 'boolean(true|false)' syntax
      const booleanMatch = template.from.match(/^boolean\((true|false)\)$/);
      if (booleanMatch) {
        return booleanMatch[1] === 'true'; // Return the boolean value (true or false)
      }

      // Handle the case where the 'from' field uses the 'null()' syntax
      if (template.from === 'null()') {
        return null; // Return null
      }

      // Handle the case where the 'from' field uses the 'number(43)' syntax
      const numberMatch = template.from.match(/^number\((\d+)\)$/);
      if (numberMatch) {
        return Number(numberMatch[1]); // Return the number inside parentheses (e.g., 43)
      }

      // Evaluate the 'if' condition if it exists
      if (template.if) {
        const condition = jexl.evalSync(template.if, data);
        if (!condition) {
          // Skip adding the field if 'if' condition is false and not required
          if (template.required) {
            this.requiredCollector.push(path ? `${path}` : 'unknown');
          }
          return undefined; // Skip the field by returning undefined
        }
      }

      // If no 'if' condition or condition is true, proceed with field evaluation
      const dataToEvaluate = jexl.evalSync(template.from, data);

      if (dataToEvaluate === null || dataToEvaluate === undefined) {
        if (template.required) {
          this.requiredCollector.push(path ? `${path}` : 'unknown');
        }
        return undefined; // Skip if data is null/undefined and not required
      }

      // Coerce the type based on the 'as' property
      return this.coerceType(dataToEvaluate, template.as);
    } catch (e) {
      throw new Error(
        `Failed to evaluate expression: ${template.from}. Error: ${e.message}`
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
    if (typeof template === 'object' && template.from) {
      if (typeof template.from === 'string' && template.from.includes('[]')) {
        if ('values' in template) {
          return this.transformArray(template as TemplateArray, data, path);
        } else {
          throw new Error(`Invalid template: ${JSON.stringify(template)}`);
        }
      }
      return this.transformField(template as TemplateField, data, path);
    } else if (typeof template === 'object') {
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
