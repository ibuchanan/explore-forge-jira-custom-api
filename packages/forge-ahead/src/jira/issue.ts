import * as jmespath from "jmespath";
import type { NamedObject } from "./api";

export interface ContentFields {
  summary: string;
  description: string;
}
export const contentFields = ["summary", "description"];

export interface CardFields {
  issuetype: NamedObject;
  summary: string;
  status: NamedObject;
  // updated: ResultDate;
  assignee?: NamedObject;
  priority?: NamedObject;
}
export const cardFields = [
  "issuetype",
  "summary",
  "status",
  "assignee",
  "priority",
];

export interface ResultIssue<T> {
  expand: string;
  id: string;
  self: string;
  key: string;
  fields: T;
  renderedFields?: T;
}

// interface IssueCard {
//   key: string;
//   url: string;
//   issuetype: string;
//   summary: string;
//   status: string;
//   // updated: ResultDate;
//   assignee?: string;
//   priority?: string;
// }

type RequestedFields = Record<string, any>;

export interface SpecifiedFields {
  key: string;
  url: string;
  summary: string;
  description: string | undefined;
}

interface IssueCard {
  specified: SpecifiedFields;
  frontmatter: Record<string, string | string[]>;
  rendered: Record<string, string>;
}

export function mapResultToCard(
  jiraApiResponse: ResultIssue<RequestedFields>,
  realizedFields: Array<RealizedContentField>,
) {
  // console.debug(`jiraApiResponse: ${JSON.stringify(jiraApiResponse)}`);
  const specified: SpecifiedFields = {
    key: jiraApiResponse.key,
    url: jiraApiResponse.self,
    summary: jiraApiResponse.fields.summary,
    description: jiraApiResponse.renderedFields?.description,
  };
  // console.debug(`specified: ${JSON.stringify(specified)}`);
  const frontmatter: Record<string, string | string[]> = realizedFields.reduce(
    (acc, f) => {
      // console.debug(`field: ${JSON.stringify(f)}`);
      if (f.type !== ContentType.Frontmatter) return acc;
      if (f.schema === undefined) return acc;
      if (f.key === undefined) return acc;
      // TODO: handle arrays
      if (f.schema.type === "array") return acc;
      const mapperFunction = mapMetaToString[f.schema.type];
      if (mapperFunction === undefined) return acc;
      // Key is the common name of the field like "Urgency", not "customfield_10101"
      // Value is created based on the field's type from Jira's metadata,
      // using the appropriate mapper,
      // applied to the data from Jira.
      if (jiraApiResponse === undefined) return acc;
      // console.debug(`"${f.name}" jiraApiResponse field: ${JSON.stringify(jiraApiResponse.fields[f.key])}`);
      acc[f.name] = mapperFunction(jiraApiResponse.fields[f.key]);
      return acc;
    },
    {} as Record<string, string | string[]>,
  );
  // console.debug(`frontmatter: ${JSON.stringify(frontmatter)}`);
  const rendered: Record<string, string> = realizedFields.reduce(
    (acc, f) => {
      // console.debug(`field: ${JSON.stringify(f)}`);
      if (f.type !== ContentType.Rendered) return acc;
      if (f.schema === undefined) return acc;
      if (f.key === undefined) return acc;
      const mapperFunction = mapMetaToString[f.schema.type];
      if (mapperFunction === undefined) return acc;
      // Key is the common name of the field like "Urgency", not "customfield_10101"
      // Value is created based on the field's type from Jira's metadata,
      // using the appropriate mapper,
      // applied to the data from Jira.
      if (jiraApiResponse.renderedFields === undefined) return acc;
      acc[f.name] = mapperFunction(jiraApiResponse.renderedFields[f.key]);
      return acc;
    },
    {} as Record<string, string>,
  );
  // console.debug(`rendered: ${JSON.stringify(rendered)}`);
  const issueCard: IssueCard = {
    specified: specified,
    frontmatter: frontmatter,
    rendered: rendered,
  };
  return issueCard;
}

export enum ContentType {
  Specified, // Plays a specific role in the output. Usually is a system field.
  Frontmatter, // Provided as a key:value in Frontmatter.
  Rendered, // Provided as Markdown (maybe with HTML) in the body.
}

interface Schema {
  type: string;
  system: string;
  items?: string;
}

export interface ContentField {
  name: string;
  type: ContentType;
}

export interface RealizedContentField extends ContentField {
  key: string | undefined;
  schema: Schema | undefined;
}

interface FieldType {
  schema: Schema;
  name: string;
  key: string;
}

export interface Meta {
  fields: Record<string, FieldType>;
}

export function mapFieldsToRealized(
  fields: Array<ContentField>,
  meta: Meta,
): Array<RealizedContentField> {
  // console.debug(`fields: ${JSON.stringify(fields)}`);
  // console.debug(`meta: ${JSON.stringify(meta)}`);
  return fields.map((field) => {
    const metafield = getFieldFromMeta(field.name, meta);
    if (metafield === undefined)
      console.info(`metafield: "${field.name}" = ${JSON.stringify(metafield)}`);
    return {
      name: field.name,
      type: field.type,
      key: metafield?.key,
      schema: metafield?.schema,
    };
  });
}

export function mapFieldsToExpand(
  fields: Array<RealizedContentField>,
): Array<string> {
  return fields.flatMap((field) => {
    if (typeof field.key === "string") {
      return field.key;
    } else {
      return [];
    }
  });
}

function getFieldFromMeta(name: string, meta: Meta) {
  // console.debug(`Searching meta for "${name}"`);
  const [oneField] = jmespath.search(
    meta,
    `fields.* | [?name == '${name}']`,
  ) as FieldType[];
  // console.debug(`oneField: ${JSON.stringify(oneField)}`);
  if (oneField) {
    return oneField;
  }
  // console.error(`Failed: No field found for "${name}"`);
  return undefined;
}

function adf2md(o: any) {
  // TODO: implement ADF to MD
  return "";
}

type MetaSchemaTypeStringFunction = (o: any) => string;
type MetaSchemaTypeStringArrayFunction = (o: any) => Array<string>;
type MetaSchemaTypes = Record<string, MetaSchemaTypeStringFunction>;
type MetaSchemaArrayTypes = Record<string, MetaSchemaTypeStringArrayFunction>;

const mapMetaToString: MetaSchemaTypes = {
  issuetype: (o: any) => o.name,
  string: (o: any) => o,
  user: (o: any) => o.displayName,
  description: (o: any) => adf2md(o), // Or get this from renderedFields
  priority: (o: any) => o.name,
  option: (o: any) => o.value,
  datetime: (o: any) => o,
  status: (o: any) => o.name,
};

const mapArrayToStringArray: MetaSchemaArrayTypes = {
  component: (o: any) => [""],
  attachment: (o: any) => [""],
  issuelinks: (o: any) => [""],
  string: (o: any) => [""],
  user: (o: any) => [""],
  "sd-customerorganization": (o: any) => [""],
};
