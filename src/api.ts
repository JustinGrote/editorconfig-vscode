import * as editorconfig from 'editorconfig'
import { isDeepStrictEqual } from 'util'
import {
	LogOutputChannel,
	TextDocument,
	TextEditor,
	TextEditorOptions,
	Uri,
	commands,
	window,
	workspace,
} from 'vscode'

/**
 * Retrieves the editorConfig for the given document and converts it into TextEditor indentation options
 */
export async function resolveEditorConfigOptions(
	doc: TextDocument,
	{
		onBeforeResolve,
		onEmptyConfig,
	}: {
		onBeforeResolve?: (relativePath: string) => void
		onEmptyConfig?: (relativePath: string) => void
	} = {},
	log?: LogOutputChannel,
) {
	const editorconfigSettings = await resolveEditorConfigFromFiles(doc, {
		onBeforeResolve,
	})

	log?.trace(
		doc.uri.fsPath,
		'resolved EditorConfig from files:',
		JSON.stringify(editorconfigSettings),
	)

	if (editorconfigSettings) {
		return fromEditorConfig(editorconfigSettings)
	}
	if (onEmptyConfig) {
		const rp = resolveFile(doc).relativePath
		if (rp) {
			onEmptyConfig(rp)
		}
	}
	return {}
}

/** @see TextEditorOptions when returned from an editor configuration have a more narrow result */
type TextEditorResolvedIndentationOptions = {
	insertSpaces: boolean
	indentSize: number
	tabSize: number
}

// Converts the editor options retrieved from an editor to a narrower type that accurately reflects the fetched values as described in the help for each item
function toTextEditorResolvedIndentationOptions(
	editor: TextEditor,
): TextEditorResolvedIndentationOptions {
	if (typeof editor.options.insertSpaces !== 'boolean') {
		throw new Error('Expected insertSpaces to be a boolean')
	}
	if (typeof editor.options.tabSize !== 'number') {
		throw new Error('Expected tabSize to be a number')
	}
	if (typeof editor.options.indentSize !== 'number') {
		throw new Error('Expected indentSize to be a number')
	}
	return {
		insertSpaces: editor.options.insertSpaces as boolean,
		tabSize: editor.options.tabSize as number,
		indentSize: editor.options.indentSize as number,
	}
}

/**
 * Applies new `TextEditorOptions` to the active text editor.
 */
export async function applyTextEditorOptions(
	editor: TextEditor,
	newOptions: TextEditorIndentationOptions,
	log?: LogOutputChannel,
) {
	const currentOptions = toTextEditorResolvedIndentationOptions(editor)
	const workspaceOptions = getWorkspaceIndentationSettings(editor.document, log)
	const optionsToUpdate: TextEditorIndentationOptions = {}

	const editorSettings = workspace.getConfiguration('editor', editor.document)

	log?.debug('Checking for text editor changes to', editor.document.uri.fsPath)
	log?.trace('Current Editor Settings:', currentOptions)
	log?.trace('Desired EditorConfig Settings:', newOptions)

	// Easy early return if we already have a match
	if (isDeepStrictEqual(newOptions, currentOptions)) {
		log?.debug('Editor already has the desired settings')
		return
	}

	Object.keys(workspaceOptions).length === 0
		? log?.debug('VSCode is set to auto-detect indentation for this file.')
		: log?.trace('VSCode Settings for file:', workspaceOptions)

	if (
		newOptions.insertSpaces !== undefined &&
		newOptions.insertSpaces !== currentOptions.insertSpaces
	) {
		log?.debug(
			'Detected change in insertSpaces from',
			currentOptions.insertSpaces,
			'to',
			newOptions.insertSpaces,
		)
		optionsToUpdate.insertSpaces = newOptions.insertSpaces
	}

	if (newOptions.indentSize !== undefined) {
		if (newOptions.indentSize === 'tabSize') {
			newOptions.tabSize = workspaceOptions.tabSize ?? 4
		}

		if (newOptions.indentSize !== currentOptions.indentSize) {
			log?.debug(
				'Detected change in indentSize from',
				currentOptions.indentSize,
				'to',
				optionsToUpdate.indentSize,
			)
			optionsToUpdate.indentSize = newOptions.indentSize
		}
	}

	if (newOptions.tabSize !== undefined) {
		if (editorSettings.get<boolean>('useTabSize')) {
			optionsToUpdate.tabSize = newOptions.tabSize
			log?.debug(
				'Detected change in tabSize from',
				currentOptions.tabSize,
				'to',
				optionsToUpdate.tabSize,
			)
		} else {
			log?.debug(
				'Not updating tabSize because useTabSize is false in the settings',
			)
		}
	}

	// If no changes, nothing to do
	if (
		optionsToUpdate.insertSpaces === undefined &&
		optionsToUpdate.indentSize === undefined &&
		optionsToUpdate.tabSize === undefined
	) {
		log?.debug(
			'No indentation differences detected between current config and EditorConfig files',
		)
		return
	}
	log?.trace('Detected changes to apply:', optionsToUpdate)
	const shouldConvert = await window.showWarningMessage(
		`Your current document indentation of ${currentOptions.insertSpaces ? currentOptions.indentSize + ' spaces' : 'tabs'} does not match the EditorConfig specification of ${newOptions.insertSpaces ? newOptions.indentSize + ' spaces' : 'tabs'}. Would you like to convert the document to match the EditorConfig style?`,
		'Yes',
		'No',
		'Always Apply For Workspace',
	)
	if (
		!(shouldConvert === 'Yes' || shouldConvert === 'Always Apply For Workspace')
	) {
		return
	}
	if (shouldConvert === 'Always Apply For Workspace') {
		log?.info('Setting autoApply to true for the workspace')
		await editorSettings.update('autoApply', true)
	}

	// If the indentation style is different, we must perform a conversion first
	if (optionsToUpdate.insertSpaces !== undefined) {
		if (optionsToUpdate.insertSpaces === false) {
			// HACK: Setting the tabs value does not convert the file automatically, we must currently use a command to do it
			commands.executeCommand('editor.action.indentationToTabs')
		}
		editor.options.insertSpaces = optionsToUpdate.insertSpaces

		// We have to set the tab size same as the insert spaces size so as to reflect properly in the editor
		if (
			optionsToUpdate.insertSpaces === true &&
			optionsToUpdate.tabSize === undefined
		) {
			optionsToUpdate.tabSize =
				(optionsToUpdate.indentSize as number) ??
				(newOptions.indentSize as number) ??
				(workspaceOptions.indentSize as number) ??
				workspaceOptions.tabSize ??
				4
		}
		editor.options.tabSize = optionsToUpdate.tabSize
	}

	// Editor should now show the converted format
	if (editor.options.insertSpaces !== optionsToUpdate.insertSpaces) {
		window.showErrorMessage('Failed to change editor indentation')
		return
	}

	if (optionsToUpdate.indentSize !== undefined) {
		editor.options.indentSize = optionsToUpdate.indentSize
	}
	if (optionsToUpdate.tabSize !== undefined) {
		editor.options.tabSize = optionsToUpdate.indentSize
	}

	log?.info('New Editor Settings:', editor.options)
}

/**
 * Picks EditorConfig-relevant props from the editor's default configuration.
 */
export function getWorkspaceIndentationSettings(
	doc?: TextDocument,
	log?: LogOutputChannel,
): TextEditorIndentationOptions {
	const workspaceConfig = workspace.getConfiguration('editor', doc)
	const detectIndentation = workspaceConfig.get<boolean>('detectIndentation')

	if (detectIndentation) {
		log?.debug(
			'VSCode detectIndentation setting is enabled for the document, ignoring document settings',
		)
	}

	return detectIndentation
		? {} // When `detectIndentation` is on, we will use whatever the editor window already says it is because it was detected.
		: {
				tabSize: workspaceConfig.get('tabSize'),
				indentSize: workspaceConfig.get('indentSize'),
				insertSpaces: workspaceConfig.get('insertSpaces'),
			}
}

/**
 * Resolves an EditorConfig configuration for the file related to a
 * `TextDocument`.
 */
export async function resolveEditorConfigFromFiles(
	doc: TextDocument,
	{
		onBeforeResolve,
	}: {
		onBeforeResolve?: (relativePath: string) => void
	} = {},
) {
	const { fileName, relativePath } = resolveFile(doc)
	if (!fileName) {
		return {}
	}
	if (relativePath) {
		onBeforeResolve?.(relativePath)
	}
	const config = await editorconfig.parse(fileName, { unset: true })
	return config
}

export function resolveFile(doc: TextDocument): {
	fileName?: string
	relativePath?: string
} {
	if (doc.languageId === 'Log') {
		return {}
	}
	const file = getFile()
	return {
		fileName: file?.fsPath,
		relativePath: file && workspace.asRelativePath(file, true),
	}

	function getFile(): Uri | undefined {
		if (!doc.isUntitled) {
			return doc.uri
		}
		if (workspace.workspaceFolders?.[0]) {
			return Uri.joinPath(workspace.workspaceFolders[0].uri, doc.fileName)
		}
		return undefined
	}
}

/** An explicit version of the text indentation options that narrows string to actual valid string values and merges auto with undefined to assume auto  */
type TextEditorIndentationOptions = {
	indentSize?: number | 'tabSize'
	tabSize?: number
	insertSpaces?: boolean
}

/**
 * Convert .editorconfig values to vscode editor options
 */
export function fromEditorConfig(
	editorConfig: editorconfig.KnownProps = {},
): TextEditorIndentationOptions {
	const options: TextEditorIndentationOptions = {}

	switch (editorConfig.indent_style) {
		case 'space':
			options.insertSpaces = true
			break
		case 'tab':
			options.insertSpaces = false
			break
		case 'unset':
			options.insertSpaces = undefined
			break
		default:
			options.insertSpaces = editorConfig.indent_style
	}

	switch (editorConfig.indent_size) {
		case 'tab':
			options.indentSize = 'tabSize'
			break
		case 'unset':
			options.indentSize = undefined
			break
		default:
			options.indentSize = editorConfig.indent_size
	}

	switch (editorConfig.tab_width) {
		case 'unset':
			options.tabSize = undefined
			break
		default:
			options.tabSize = editorConfig.tab_width
	}

	return options
}

/**
 * Convert vscode editor options to .editorconfig values
 */
export function toEditorConfig(options: TextEditorOptions) {
	const result: editorconfig.KnownProps = {}

	switch (options.insertSpaces) {
		case true:
			result.indent_style = 'space'
			if (options.tabSize) {
				result.indent_size = resolveTabSize(options.tabSize)
			}
			break
		case false:
		case 'auto':
			result.indent_style = 'tab'
			if (options.tabSize) {
				result.tab_width = resolveTabSize(options.tabSize)
			}
			break
	}

	return result

	/**
	 * Convert vscode tabSize option into numeric value
	 */
	function resolveTabSize(tabSize: number | string) {
		return tabSize === 'auto' ? 4 : parseInt(String(tabSize), 10)
	}
}
