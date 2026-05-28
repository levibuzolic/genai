import { CopyPlus, Edit3, Plus, Search, Trash2, WandSparkles } from "lucide-react"
import * as React from "react"

import { Field } from "@/components/common/Field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { mediaUrlForItem } from "@/lib/media"
import type { CreateMode, CreateTemplate, CreateTemplateType } from "@/types/domain"

type TemplateEditorState = {
  id: string
  label: string
  description: string
  type: CreateTemplateType
  modeId: string
  prompt: string
  negativePrompt: string
  quality: string
  imagePrompt: string
  videoPrompt: string
}

const EMPTY_TEMPLATE: TemplateEditorState = {
  id: "",
  label: "",
  description: "",
  type: "video",
  modeId: "custom-video",
  prompt: "",
  negativePrompt: "",
  quality: "720p-4",
  imagePrompt: "",
  videoPrompt: "",
}

export function TemplateBrowser({
  templates,
  modes,
  loading,
  status,
  onUseTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  templates: CreateTemplate[]
  modes: CreateMode[]
  loading: boolean
  status: string
  onUseTemplate: (template: CreateTemplate) => void
  onSaveTemplate: (draft: CreateTemplateDraft) => Promise<void>
  onDeleteTemplate: (templateId: string) => Promise<void>
}) {
  const [query, setQuery] = React.useState("")
  const [editor, setEditor] = React.useState<TemplateEditorState>(EMPTY_TEMPLATE)
  const qualityOptions = modes.find((mode) => mode.id === "custom-video")?.fields?.find((field) => field.name === "quality")?.options || []
  const filteredTemplates = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return templates

    return templates.filter((template) =>
      [template.label, template.description, template.type, template.prompt, template.settings?.params?.["prompt"]].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    )
  }, [query, templates])

  function editTemplate(template: CreateTemplate) {
    const params = template.settings?.params || {}
    const imageStep = template.workflow?.find((step) => step.modeId === "custom-image")
    const videoStep = template.workflow?.find((step) => step.modeId === "custom-video")

    setEditor({
      id: template.id,
      label: template.label,
      description: template.description || "",
      type: template.type,
      modeId: template.settings?.modeId || (template.type === "image" ? "custom-image" : "custom-video"),
      prompt: params["prompt"] || "",
      negativePrompt: params["negativePrompt"] || "",
      quality: params["quality"] || "720p-4",
      imagePrompt: imageStep?.params["prompt"] || params["prompt"] || "",
      videoPrompt: videoStep?.params["prompt"] || params["prompt"] || "",
    })
  }

  async function saveEditor() {
    await onSaveTemplate(templateDraftFromEditor(editor))
    setEditor(EMPTY_TEMPLATE)
  }

  return (
    <section className="templateBrowser" aria-label="Template browser">
      <div className="templateBrowserHeader">
        <div>
          <Badge variant="muted">
            <WandSparkles className="size-3" />
            Templates
          </Badge>
          <h2>Saved templates</h2>
          <p>{loading ? "Loading templates..." : status}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setEditor(EMPTY_TEMPLATE)}>
          <Plus />
          New
        </Button>
      </div>

      <div className="templateBrowserLayout">
        <section className="templateList" aria-label="Saved templates">
          <div className="search-shell templateSearch">
            <Search className="size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
            />
          </div>
          <div className="templateCards">
            {filteredTemplates.map((template) => (
              <article key={template.id} className="templateCard">
                <div className="templatePreviewStrip">
                  {(template.previews || []).slice(0, 4).map((item) => (
                    <img key={item.id} src={mediaUrlForItem(item) || ""} alt="" />
                  ))}
                  {!template.previews?.length && <span>No media yet</span>}
                </div>
                <div className="templateCardBody">
                  <div>
                    <Badge variant={template.type === "combo" ? "warning" : "muted"}>{template.type}</Badge>
                    <h3>{template.label}</h3>
                    <p>{template.description || template.settings?.params?.["prompt"] || "No description"}</p>
                  </div>
                  <div className="templateCardActions">
                    <Button type="button" variant="outline" size="sm" onClick={() => onUseTemplate(template)}>
                      <CopyPlus />
                      Use
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => editTemplate(template)}
                      aria-label={`Edit ${template.label}`}
                    >
                      <Edit3 />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDeleteTemplate(template.id)}
                      aria-label={`Delete ${template.label}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
            {!filteredTemplates.length && <div className="templateEmpty">No templates match the current filter.</div>}
          </div>
        </section>

        <section className="templateEditor" aria-label="Template editor">
          <h3>{editor.id ? "Edit template" : "New template"}</h3>
          <Field label="Name">
            <Input value={editor.label} onChange={(event) => setEditor({ ...editor, label: event.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
          </Field>
          <Field label="Type">
            <select
              className="native-select"
              value={editor.type}
              onChange={(event) => {
                const type = event.target.value as CreateTemplateType
                setEditor({
                  ...editor,
                  type,
                  modeId: type === "image" ? "custom-image" : "custom-video",
                })
              }}
            >
              <option value="image">Image edit</option>
              <option value="video">Video creation</option>
              <option value="combo">Image edit + video</option>
            </select>
          </Field>
          {editor.type !== "combo" ? (
            <>
              <Field label="Mode">
                <select
                  className="native-select"
                  value={editor.modeId}
                  onChange={(event) => setEditor({ ...editor, modeId: event.target.value })}
                >
                  {modes
                    .filter((mode) => mode.kind !== "template")
                    .map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Prompt">
                <Textarea value={editor.prompt} onChange={(event) => setEditor({ ...editor, prompt: event.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Image edit prompt">
                <Textarea value={editor.imagePrompt} onChange={(event) => setEditor({ ...editor, imagePrompt: event.target.value })} />
              </Field>
              <Field label="Video prompt">
                <Textarea value={editor.videoPrompt} onChange={(event) => setEditor({ ...editor, videoPrompt: event.target.value })} />
              </Field>
            </>
          )}
          {editor.type !== "image" && (
            <Field label="Quality">
              <select
                className="native-select"
                value={editor.quality}
                onChange={(event) => setEditor({ ...editor, quality: event.target.value })}
              >
                {qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {editor.type === "video" && (
            <Field label="Negative prompt">
              <Textarea value={editor.negativePrompt} onChange={(event) => setEditor({ ...editor, negativePrompt: event.target.value })} />
            </Field>
          )}
          <div className="templateEditorActions">
            <Button type="button" onClick={() => void saveEditor()} disabled={!editor.label.trim()}>
              Save template
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditor(EMPTY_TEMPLATE)}>
              Clear
            </Button>
          </div>
        </section>
      </div>
    </section>
  )
}

export type CreateTemplateDraft = {
  id?: string
  label: string
  description: string
  type: CreateTemplateType
  settings: CreateTemplate["settings"]
  workflow: CreateTemplate["workflow"]
}

function templateDraftFromEditor(editor: TemplateEditorState): CreateTemplateDraft {
  if (editor.type === "combo") {
    return {
      ...templateIdPatch(editor.id),
      label: editor.label,
      description: editor.description,
      type: "combo",
      settings: {
        modeId: "custom-video",
        source: null,
        params: {
          prompt: editor.videoPrompt,
          quality: editor.quality,
        },
      },
      workflow: [
        {
          modeId: "custom-image",
          params: {
            prompt: editor.imagePrompt,
          },
        },
        {
          modeId: "custom-video",
          params: {
            prompt: editor.videoPrompt,
            quality: editor.quality,
          },
        },
      ],
    }
  }

  return {
    ...templateIdPatch(editor.id),
    label: editor.label,
    description: editor.description,
    type: editor.type,
    settings: {
      modeId: editor.modeId,
      source: null,
      params: {
        prompt: editor.prompt,
        quality: editor.quality,
        negativePrompt: editor.negativePrompt,
      },
    },
    workflow: [
      {
        modeId: editor.modeId,
        params: {
          prompt: editor.prompt,
          quality: editor.quality,
          negativePrompt: editor.negativePrompt,
        },
      },
    ],
  }
}

function templateIdPatch(id: string) {
  return id ? { id } : {}
}
