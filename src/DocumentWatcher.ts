import {
	Disposable,
	LogOutputChannel,
	Selection,
	TextDocument,
	TextDocumentSaveReason,
	TextEditor,
	window,
	workspace,
} from 'vscode'
import {
	InsertFinalNewline,
	PreSaveTransformation,
	SetEndOfLine,
	TrimTrailingWhitespace,
} from './transformations'

import {
	applyTextEditorOptions,
	resolveEditorConfigFromFiles,
	resolveEditorConfigOptions,
} from './api'

/**
 * Watches for changes to the active text editor and applies EditorConfig settings if required
 */
export default class DocumentWatcher {
	private subscriptions: Disposable[] = []
	private preSaveTransformations: PreSaveTransformation[] = [
		new SetEndOfLine(),
		new TrimTrailingWhitespace(),
		new InsertFinalNewline(),
	]

	public constructor(public logger: LogOutputChannel) {
		this.log('Initializing document watcher...')

		// Process the existing text editor
		// TODO: Handle this fire-and-forget async method for errors
		this.handleChangeActiveTextEditor(window.activeTextEditor)

		this.subscriptions.push(
			window.onDidChangeActiveTextEditor(async editor => {
				await this.handleChangeActiveTextEditor(editor)
			}),

			workspace.onWillSaveTextDocument(async e => {
				let selections: Selection[] = []
				const activeEditor = window.activeTextEditor
				const activeDoc = activeEditor?.document
				if (activeDoc && activeDoc === e.document && activeEditor) {
					selections.push(...activeEditor.selections)
				}
				const transformations = this.calculatePreSaveTransformations(
					e.document,
					e.reason,
				)
				e.waitUntil(transformations)
				if (selections.length) {
					const edits = await transformations
					if (activeEditor && edits.length) {
						activeEditor.selections = selections
					}
				}
			}),

			// workspace.onDidSaveTextDocument(doc => {
			// 	if (path.basename(doc.fileName) === '.editorconfig') {
			// 		this.log('.editorconfig file saved.')
			// 	}
			// }),
			// window.onDidChangeWindowState(async state => {
			// 	if (state.focused && this.doc) {
			// 		const newOptions = await resolveTextEditorOptions(
			// 			this.doc,
			// 			{
			// 				onEmptyConfig: this.onEmptyConfig,
			// 			},
			// 			this.log.bind(this),
			// 		)
			// 		await applyTextEditorOptions(newOptions, {
			// 			onNoActiveTextEditor: this.onNoActiveTextEditor,
			// 			onSuccess: this.onSuccess,
			// 		})
			// 	}
			// }),
		)

		this.log('Document watcher initialized')
	}

	public onEmptyConfig = (relativePath: string) => {
		this.log(`${relativePath}: No configuration.`)
	}

	public onBeforeResolve = (relativePath: string) => {
		this.log(`${relativePath}: Using EditorConfig core...`)
	}

	public onNoActiveTextEditor = () => {
		this.log('No more open editors.')
	}

	public log(...messages: string[]) {
		this.logger.info(messages.join(' '))
	}

	public dispose() {
		this.subscriptions.forEach(d => d.dispose())
	}

	private async calculatePreSaveTransformations(
		doc: TextDocument,
		reason: TextDocumentSaveReason,
	) {
		const editorconfigSettings = await resolveEditorConfigFromFiles(doc, {
			onBeforeResolve: this.onBeforeResolve,
		})
		const relativePath = workspace.asRelativePath(doc.fileName)

		if (!editorconfigSettings) {
			this.log(`${relativePath}: No configuration found for pre-save.`)
			return []
		}

		return [
			...this.preSaveTransformations.flatMap(transformer => {
				const { edits, message } = transformer.transform(
					editorconfigSettings,
					doc,
					reason,
				)
				if (edits instanceof Error) {
					this.log(`${relativePath}: ${edits.message}`)
					return []
				}
				if (message) {
					this.log(`${relativePath}: ${message}`)
				}
				return edits
			}),
		]
	}

	private async handleChangeActiveTextEditor(editor?: TextEditor) {
		if (editor?.document === undefined) {
			this.log('No document in active text editor. Nothing to do.')
			return
		}

		const desiredOptions = await resolveEditorConfigOptions(
			editor.document,
			{
				onEmptyConfig: this.onEmptyConfig,
			},
			this.logger,
		)

		applyTextEditorOptions(editor, desiredOptions, this.logger)
	}
}
