import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { CreateStudio, formatAccountOptionLabel } from "./CreateStudio"
import type { CreateStudioProps } from "./types"

afterEach(() => {
  cleanup()
})

function noop() {
  return undefined
}

async function noopAsync() {
  return undefined
}

const baseProps = {
  sourceKind: "upload",
  setSourceKind: noop,
  sourceItems: [],
  sourceItemsLoading: false,
  onSelectCatalogSource: noop,
  onRefreshCatalogSources: noopAsync,
  selectedSource: null,
  uploadMeta: "",
  uploadedDataUrl: null,
  uploadedName: "",
  sourceUrl: "",
  setSourceUrl: noop,
  modes: [{ id: "custom-video", label: "Custom Video", source: { required: false } }],
  modeId: "custom-video",
  setModeId: noop,
  accountOptions: ["primary@example.com", "backup@example.com"],
  selectedAccountEmail: "primary@example.com",
  setSelectedAccountEmail: noop,
  pendingGenerationCountsByAccount: { "primary@example.com": 2, "backup@example.com": 0 },
  pendingGenerationCount: 2,
  queuedGenerationCount: 0,
  generationConcurrencyLimit: 2,
  prompt: "",
  setPrompt: noop,
  negativePrompt: "",
  setNegativePrompt: noop,
  promptField: undefined,
  modelId: "",
  setModelId: noop,
  modelField: undefined,
  quality: "",
  setQuality: noop,
  qualityField: undefined,
  createStatus: "Ready",
  createSubmitting: false,
  isDraggingUpload: false,
  setIsDraggingUpload: noop,
  fileInputRef: { current: null },
  onUploadFile: noopAsync,
  onClearSource: noop,
  onSubmit: noopAsync,
  onReset: noop,
  onClose: noop,
  templates: [],
  templateSearch: "",
  setTemplateSearch: noop,
  selectedTemplateId: "",
  onApplyTemplate: noop,
  onClearTemplate: noop,
  templateType: "video",
  setTemplateType: noop,
  onSaveCurrentTemplate: noopAsync,
  onOpenTemplates: noop,
  templateJobId: "",
  setTemplateJobId: noop,
  templateLabel: "",
  setTemplateLabel: noop,
  onImportTemplate: noopAsync,
  creations: [],
  activeCreationCount: 0,
  creationHistoryLoading: false,
  selectedCreation: null,
  selectedCreationEvents: [],
  creationHistoryStatus: "",
  onRefreshCreations: noopAsync,
  onCreationDetails: noopAsync,
  onCloseCreationDetails: noop,
  onDuplicateCreation: noopAsync,
  onSaveCreationTemplate: noopAsync,
} satisfies CreateStudioProps

const sourceItemsFixture = [
  {
    id: "source-image-1",
    type: "image",
    prompt: "source portrait",
    localFile: "renders/source.png",
  },
]

const catalogSourceModesFixture = [{ id: "custom-video", label: "Custom Video", source: { required: true } }]

describe("CreateStudio", () => {
  it("formats pending generation counts in account labels", () => {
    expect(formatAccountOptionLabel("primary@example.com", 2)).toBe("primary@example.com (2 pending)")
    expect(formatAccountOptionLabel("backup@example.com", 0)).toBe("backup@example.com (0 pending)")
  })

  it("shows the selected account pending count in the account dropdown", () => {
    render(<CreateStudio {...baseProps} />)

    expect(screen.getByText("primary@example.com (2 pending)")).toBeTruthy()
  })

  it("browses library images for collection sources", () => {
    let selectedId = ""

    render(
      <CreateStudio
        {...baseProps}
        sourceKind="catalog"
        modes={catalogSourceModesFixture}
        sourceItems={sourceItemsFixture}
        onSelectCatalogSource={(item) => {
          selectedId = item.id
        }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Browse library" }))
    fireEvent.click(screen.getByRole("button", { name: "source portrait" }))

    expect(selectedId).toBe("source-image-1")
  })
})
