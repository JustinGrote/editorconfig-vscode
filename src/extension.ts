import {
	commands,
	DocumentSelector,
	ExtensionContext,
	languages,
	extensions,
	window,
} from 'vscode'
import {
	applyTextEditorOptions,
	fromEditorConfig,
	resolveEditorConfigOptions,
	toEditorConfig,
} from './api'
import { generateEditorConfig } from './commands/generateEditorConfig'
import EditorConfigDocumentWatcher from './DocumentWatcher'
import EditorConfigCompletionProvider from './EditorConfigCompletionProvider'

/**
 * Main entry
 */
export function activate(ctx: ExtensionContext) {
	// Test for an extension conflict in vscode and exit with error if found
	if (extensions.getExtension('editorconfig.editorconfig')) {
		window.showErrorMessage(
			'You have both "editorconfig.editorconfig" and "justingrote.editorconfig" installed which conflict with each other. Please uninstall one of them.',
		)
		return
	}

	const logger = window.createOutputChannel('EditorConfig', { log: true })

	ctx.subscriptions.push(new EditorConfigDocumentWatcher(logger))

	// register .editorconfig file completion provider
	const editorConfigFileSelector: DocumentSelector = {
		language: 'editorconfig',
		pattern: '**/.editorconfig',
		scheme: 'file',
	}
	languages.registerCompletionItemProvider(
		editorConfigFileSelector,
		new EditorConfigCompletionProvider(),
	)

	// register an internal command used to automatically display IntelliSense
	// when editing a .editorconfig file
	commands.registerCommand('editorconfig._triggerSuggestAfterDelay', () => {
		setTimeout(() => {
			commands.executeCommand('editor.action.triggerSuggest')
		}, 100)
	})

	// register a command handler to generate a .editorconfig file
	commands.registerCommand('EditorConfig.generate', generateEditorConfig)

	return {
		applyTextEditorOptions,
		fromEditorConfig,
		resolveTextEditorOptions: resolveEditorConfigOptions,
		toEditorConfig,
	}
}
