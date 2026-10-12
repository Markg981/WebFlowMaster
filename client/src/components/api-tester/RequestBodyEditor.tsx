import { useTranslation } from 'react-i18next';
import { PlusCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor as Editor } from '@/components/CodeEditor';
import { KeyValueEditor } from './KeyValueEditor';
import {
  bodyTypeDisplayMap,
  bodyTypes,
  type BodyType,
  type FormDataField,
  type KeyValuePair,
} from './request-model';

type Props = {
  bodyType: BodyType;
  onBodyTypeChange: (type: BodyType) => void;
  /** The request method: GET and HEAD carry no body, so the raw editor is read-only for them. */
  method: string;
  disabled: boolean;
  monacoTheme: string;
  /** Ctrl/Cmd+Enter in the raw editor sends the request. */
  onSend: () => void;

  rawContentType: string;
  onRawContentTypeChange: (contentType: string) => void;
  rawBody: string;
  onRawBodyChange: (body: string) => void;

  binaryFile: File | null;
  onBinaryFileChange: (file: File | null) => void;

  graphqlQuery: string;
  onGraphqlQueryChange: (query: string) => void;
  graphqlVariables: string;
  onGraphqlVariablesChange: (variables: string) => void;

  formData: FormDataField[];
  onFormDataChange: (
    index: number,
    field: keyof FormDataField,
    value: string | boolean | File | null,
  ) => void;
  onAddFormDataField: () => void;
  onRemoveFormDataField: (index: number) => void;

  urlEncoded: KeyValuePair[];
  onUrlEncodedChange: (index: number, field: keyof KeyValuePair, value: string | boolean) => void;
  onAddUrlEncodedField: () => void;
  onRemoveUrlEncodedField: (index: number) => void;
};

const editorOptions = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  wordWrap: 'on' as const,
  automaticLayout: true,
};

function rawEditorLanguage(contentType: string) {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('html')) return 'html';
  return 'plaintext';
}

/** The Body tab of the API tester: the body type, and the editor for the one chosen. */
export function RequestBodyEditor(props: Props) {
  const { t } = useTranslation();
  const { bodyType, disabled, monacoTheme } = props;
  const rawReadOnly = disabled || props.method === 'GET' || props.method === 'HEAD';

  return (
    <div className="p-4 border rounded-md min-h-[240px] space-y-4">
      <div>
        <Label className="text-sm font-medium mb-2 block">
          {t('apiTesterPage.bodyType.label')}
        </Label>
        <RadioGroup
          value={bodyType}
          onValueChange={(value: string) => props.onBodyTypeChange(value as BodyType)}
          className="flex flex-wrap gap-x-4 gap-y-2"
          disabled={disabled}
        >
          {bodyTypes.map((type) => (
            <div key={type} className="flex items-center space-x-2">
              <RadioGroupItem value={type} id={`body-type-${type}`} disabled={disabled} />
              <Label htmlFor={`body-type-${type}`} className="font-normal">
                {bodyTypeDisplayMap[type]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="mt-4">
        {bodyType === 'none' && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('apiTesterPage.thisRequestDoesNotHaveA.description')}
          </p>
        )}

        {bodyType === 'raw' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="raw-content-type">{t('apiTesterPage.contentType.label')}</Label>
              <Select
                value={props.rawContentType}
                onValueChange={props.onRawContentTypeChange}
                disabled={disabled}
              >
                <SelectTrigger id="raw-content-type" className="mt-1">
                  <SelectValue placeholder={t('apiTesterPage.selectContentType.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="application/json">
                    {t('apiTesterPage.applicationjson.text')}
                  </SelectItem>
                  <SelectItem value="text/plain">{t('apiTesterPage.textplain.text')}</SelectItem>
                  <SelectItem value="application/xml">
                    {t('apiTesterPage.applicationxml.text')}
                  </SelectItem>
                  <SelectItem value="text/html">{t('apiTesterPage.texthtml.text')}</SelectItem>
                  <SelectItem value="application/javascript">
                    {t('apiTesterPage.applicationjavascript.text')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="requestBodyEditorRaw">{t('apiTesterPage.body.label')}</Label>
              <div className="mt-1 border rounded-md overflow-hidden">
                <Editor
                  height="200px"
                  language={rawEditorLanguage(props.rawContentType)}
                  theme={monacoTheme}
                  value={props.rawBody}
                  onChange={(value) => props.onRawBodyChange(value || '')}
                  options={{
                    ...editorOptions,
                    tabSize: 2,
                    insertSpaces: true,
                    readOnly: rawReadOnly,
                  }}
                  onMount={(editor, monaco) => {
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                      if (!disabled) props.onSend();
                    });
                  }}
                  className={rawReadOnly ? 'opacity-50 cursor-not-allowed' : ''}
                />
              </div>
            </div>
          </div>
        )}

        {bodyType === 'binary' && (
          <div>
            <Label htmlFor="binary-file-input">{t('apiTesterPage.uploadFile.button')}</Label>
            <Input
              id="binary-file-input"
              type="file"
              onChange={(e) => props.onBinaryFileChange(e.target.files ? e.target.files[0] : null)}
              className="mt-1"
              disabled={disabled}
            />
            {props.binaryFile && (
              <p className="text-sm text-muted-foreground mt-2">
                Selected file: {props.binaryFile.name} ({Math.round(props.binaryFile.size / 1024)}{' '}
                KB)
              </p>
            )}
          </div>
        )}

        {bodyType === 'GraphQL' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="graphqlQueryEditor">{t('apiTesterPage.graphqlQuery.label')}</Label>
              <div className="mt-1 border rounded-md overflow-hidden">
                <Editor
                  height="150px"
                  language="graphql"
                  theme={monacoTheme}
                  value={props.graphqlQuery}
                  onChange={(value) => props.onGraphqlQueryChange(value || '')}
                  options={{ ...editorOptions, readOnly: disabled }}
                  className={disabled ? 'opacity-50 cursor-not-allowed' : ''}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="graphqlVariablesEditor">
                {t('apiTesterPage.graphqlVariablesJson.label')}
              </Label>
              <div className="mt-1 border rounded-md overflow-hidden">
                <Editor
                  height="100px"
                  language="json"
                  theme={monacoTheme}
                  value={props.graphqlVariables}
                  onChange={(value) => props.onGraphqlVariablesChange(value || '')}
                  options={{ ...editorOptions, readOnly: disabled }}
                  className={disabled ? 'opacity-50 cursor-not-allowed' : ''}
                />
              </div>
            </div>
          </div>
        )}

        {bodyType === 'form-data' && (
          <div className="space-y-2">
            {props.formData.map((field, index) => (
              <div key={field.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`fd-enabled-${field.id}`}
                  checked={field.enabled}
                  onCheckedChange={(checked) => props.onFormDataChange(index, 'enabled', !!checked)}
                  disabled={disabled}
                />
                <Input
                  placeholder={t('apiTesterPage.key.label')}
                  value={field.key}
                  onChange={(e) => props.onFormDataChange(index, 'key', e.target.value)}
                  className="flex-1"
                  disabled={disabled}
                />
                <Select
                  value={field.type}
                  onValueChange={(type: 'text' | 'file') =>
                    props.onFormDataChange(index, 'type', type)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="w-[100px]">
                    <SelectValue placeholder={t('apiTesterPage.type.label')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">{t('apiTesterPage.text.text')}</SelectItem>
                    <SelectItem value="file">{t('apiTesterPage.file.text')}</SelectItem>
                  </SelectContent>
                </Select>
                {field.type === 'text' ? (
                  <Input
                    placeholder={t('apiTesterPage.value.label')}
                    value={field.value as string} // a 'text' field holds a string
                    onChange={(e) => props.onFormDataChange(index, 'value', e.target.value)}
                    className="flex-1"
                    disabled={disabled}
                  />
                ) : (
                  <Input
                    type="file"
                    onChange={(e) =>
                      props.onFormDataChange(
                        index,
                        'value',
                        e.target.files ? e.target.files[0] : null,
                      )
                    }
                    className="flex-1"
                    disabled={disabled}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => props.onRemoveFormDataField(index)}
                  disabled={disabled}
                  aria-label={t('apiTester.requestBodyEditor.removeField', 'Remove field')}
                >
                  <XCircle className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={props.onAddFormDataField}
              disabled={disabled}
            >
              <PlusCircle className="mr-2 h-4 w-4" /> {t('apiTesterPage.addField.button')}
            </Button>
          </div>
        )}

        {bodyType === 'x-www-form-urlencoded' && (
          <div className="space-y-2">
            <KeyValueEditor
              rows={props.urlEncoded}
              idPrefix="ue"
              keyPlaceholder={t('apiTesterPage.key.label')}
              valuePlaceholder={t('apiTesterPage.value.label')}
              addLabel={t('apiTesterPage.addParam.button')}
              disabled={disabled}
              onChange={props.onUrlEncodedChange}
              onAdd={props.onAddUrlEncodedField}
              onRemove={props.onRemoveUrlEncodedField}
            />
          </div>
        )}
      </div>
    </div>
  );
}
