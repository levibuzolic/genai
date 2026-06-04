import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateStudio, formatAccountOptionLabel, formatAutoAccountOptionLabel } from "./CreateStudio"
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
  autoAccountEmail: "backup@example.com",
  setSelectedAccountEmail: noop,
  pendingGenerationCountsByAccount: { "primary@example.com": 2, "backup@example.com": 0 },
  queuedGenerationCountsByAccount: { "primary@example.com": 1, "backup@example.com": 0 },
  pendingGenerationCount: 2,
  queuedGenerationCount: 1,
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
    expect(formatAccountOptionLabel("primary@example.com", 2, 1)).toBe("primary@example.com (2 pending, 1 queued)")
    expect(formatAutoAccountOptionLabel("backup@example.com", 0, 0)).toBe("Auto · backup@example.com (0 pending, 0 queued)")
  })

  it("shows the selected account pending and queued counts in the account dropdown", () => {
    render(<CreateStudio {...baseProps} />)

    expect(screen.getByText("primary@example.com (2 pending, 1 queued)")).toBeTruthy()
  })

  it("defaults account selection to Auto", () => {
    render(<CreateStudio {...baseProps} selectedAccountEmail="" />)

    expect(screen.getByText("Auto · backup@example.com (0 pending, 0 queued)")).toBeTruthy()
  })

  it("submits through the local creation queue", () => {
    const onSubmit = vi.fn<CreateStudioProps["onSubmit"]>()
    render(<CreateStudio {...baseProps} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(onSubmit).toHaveBeenCalledWith({ queue: true })
  })

  it("splits video quality into resolution tabs and a duration slider", () => {
    const setQuality = vi.fn<(value: string) => void>()
    render(
      <CreateStudio
        {...baseProps}
        quality="720p-8"
        setQuality={setQuality}
        qualityField={{
          name: "quality",
          label: "Quality",
          options: [
            { label: "720p · 4s", value: "720p-4", resolution: "720p", duration: 4, description: "48 Amethyst" },
            { label: "720p · 8s", value: "720p-8", resolution: "720p", duration: 8, description: "96 Amethyst" },
            { label: "1080p · 4s", value: "1080p-4", resolution: "1080p", duration: 4, description: "72 Amethyst" },
            { label: "1080p · 8s", value: "1080p-8", resolution: "1080p", duration: 8, description: "144 Amethyst" },
          ],
        }}
      />,
    )

    const resolutionTab = screen.getByRole("tab", { name: "1080p" })
    resolutionTab.focus()
    fireEvent.keyDown(resolutionTab, { key: "Enter", code: "Enter" })
    expect(setQuality).toHaveBeenCalledWith("1080p-8")

    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "4" } })
    expect(setQuality).toHaveBeenCalledWith("720p-4")
    expect(screen.queryByText(/Amethyst/)).toBeNull()
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
