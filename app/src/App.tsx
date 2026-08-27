import { useState } from 'react'
import { MOCK_USER, useCurrentCourse, useStore } from './store'
import { StoreProvider } from './StoreProvider'
import { useIsMobile } from './hooks/useMediaQuery'
import { useKeyboardOpen } from './hooks/useKeyboardOpen'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { ProgressCollapsible, ProgressPanel } from './components/ProgressPanel'
import { PromptInput } from './components/PromptInput'
import { DevPanel } from './components/DevPanel'
import { Modal, DialogButtons, btnDanger, btnGhost, btnPrimary } from './components/Modal'
import { IconMenu, IconUser } from './components/Icons'
import { Login } from './screens/Login'
import { EmptyState } from './screens/EmptyState'
import { UploadTab } from './screens/UploadTab'
import { Generating } from './screens/Generating'
import { GenerateFailed } from './screens/GenerateFailed'
import { LectureTab } from './screens/LectureTab'
import { QuizTab } from './screens/QuizTab'

function Content() {
  const { state } = useStore()
  const course = useCurrentCourse()

  if (state.tab === 'upload') return <UploadTab />
  if (!course) return <EmptyState />
  if (course.status === 'generating') return <Generating course={course} />
  if (course.status === 'failed') return <GenerateFailed course={course} />
  if (state.tab === 'quiz') return <QuizTab course={course} />
  return <LectureTab course={course} />
}

function Dialogs() {
  const { state, dispatch } = useStore()
  const [renameValue, setRenameValue] = useState('')

  const menu = state.menu
  const modal = state.modal
  const menuCourse =
    menu?.type === 'course' ? state.courses.find((c) => c.id === menu.courseId) : undefined

  return (
    <>
      {/* SC-13 講義メニュー ／ SC-15 ユーザーメニュー */}
      {menu && (
        <div className="fixed inset-0 z-50" onClick={() => dispatch({ type: 'openMenu', menu: null })}>
          <div
            className={`absolute w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ${
              menu.type === 'user'
                ? // 起動元の隣に出す：モバイルはヘッダーのアカウントアイコン、
                  // デスクトップはサイドバー最下部のユーザーボタン（A-4）
                  'top-14 right-3 md:top-auto md:right-auto md:bottom-3 md:left-[16.5rem]'
                : // 講義メニューは講義一覧の隣
                  'bottom-24 left-4 md:bottom-auto md:top-28 md:left-[16.5rem]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.type === 'user' ? (
              <>
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-800">{MOCK_USER.name}</p>
                  <p className="truncate text-xs text-slate-500">{MOCK_USER.email}</p>
                </div>
                <button
                  onClick={() => dispatch({ type: 'logout' })}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                >
                  ログアウト
                </button>
              </>
            ) : (
              menuCourse && (
                <>
                  <div className="px-3 pt-2.5 pb-1">
                    <label className="text-[11px] font-medium text-slate-500">名前を変更</label>
                    <div className="mt-1.5 flex gap-1.5">
                      <input
                        autoFocus
                        defaultValue={menuCourse.title}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
                      />
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'renameCourse',
                            courseId: menuCourse.id,
                            title: (renameValue || menuCourse.title).trim() || menuCourse.title,
                          })
                        }
                        className="shrink-0 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      dispatch({ type: 'openMenu', menu: null })
                      dispatch({ type: 'openModal', modal: { type: 'deleteCourse', courseId: menuCourse.id } })
                    }}
                    className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                  >
                    削除
                  </button>
                </>
              )
            )}
          </div>
        </div>
      )}

      {/* SC-04 作成確認ダイアログ（§4.1.5） */}
      {modal?.type === 'confirmCreate' && (
        <Modal onClose={() => dispatch({ type: 'openModal', modal: null })} labelledBy="dlg-create">
          <h2 id="dlg-create" className="text-base font-bold text-slate-900">
            この内容で講義と確認テストを作成しますか？
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            {modal.title} ／ {modal.charCount.toLocaleString()} 文字
          </p>
          <DialogButtons>
            <button className={btnGhost} onClick={() => dispatch({ type: 'openModal', modal: null })}>
              キャンセル
            </button>
            <button className={btnPrimary} onClick={() => dispatch({ type: 'createCourse' })}>
              作成する
            </button>
          </DialogButtons>
        </Modal>
      )}

      {/* SC-14 削除確認ダイアログ（§4.4） */}
      {modal?.type === 'deleteCourse' && (
        <Modal onClose={() => dispatch({ type: 'openModal', modal: null })} labelledBy="dlg-del">
          <h2 id="dlg-del" className="text-base font-bold text-slate-900">
            「{state.courses.find((c) => c.id === modal.courseId)?.title}」を削除しますか？
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            講義・対話ログ・確認テスト・解答記録がすべて削除されます。元に戻せません。
          </p>
          <DialogButtons>
            <button className={btnGhost} onClick={() => dispatch({ type: 'openModal', modal: null })}>
              キャンセル
            </button>
            <button className={btnDanger} onClick={() => dispatch({ type: 'deleteCourse', courseId: modal.courseId })}>
              削除する
            </button>
          </DialogButtons>
        </Modal>
      )}
    </>
  )
}

function Shell() {
  const { state, dispatch } = useStore()
  const course = useCurrentCourse()
  const isMobile = useIsMobile()
  const keyboardOpen = useKeyboardOpen()

  if (!state.authed) {
    return (
      <>
        <Login />
        <DevPanel />
      </>
    )
  }

  // C-1・E-1 は講義タブでのみ表示する（§3.4）
  const showLectureChrome = state.tab === 'lecture' && !!course && course.status === 'ready'

  if (isMobile) {
    return (
      <div className="flex h-full flex-col bg-slate-100">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5">
          <button
            onClick={() => dispatch({ type: 'setDrawer', open: true })}
            aria-label="メニューを開く"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-slate-900">AI講師</span>
          <button
            onClick={() => dispatch({ type: 'openMenu', menu: { type: 'user' } })}
            aria-label="アカウント"
            className="ml-auto rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <IconUser className="h-5 w-5" />
          </button>
        </header>

        {showLectureChrome && <ProgressCollapsible course={course} />}

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Content />
        </main>

        {showLectureChrome && (
          <div className="shrink-0 border-t border-slate-200 bg-slate-100">
            <PromptInput disabled={course.currentStepId === null} />
          </div>
        )}

        {/* Q-15：キーボード表示中はタブバーを隠す（§3.3） */}
        {!keyboardOpen && (
          <div className="shrink-0">
            <TabBar variant="mobile" />
          </div>
        )}

        {state.drawerOpen && (
          <div className="fixed inset-0 z-40" onClick={() => dispatch({ type: 'setDrawer', open: false })}>
            <div className="absolute inset-0 bg-slate-900/40" />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85%]" onClick={(e) => e.stopPropagation()}>
              <Sidebar onClose={() => dispatch({ type: 'setDrawer', open: false })} />
            </div>
          </div>
        )}

        <Dialogs />
        <DevPanel />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-slate-100">
      <div className="w-64 shrink-0">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0">
          <TabBar variant="desktop" />
        </div>

        <div className="flex min-h-0 flex-1 gap-4 px-4 pb-0">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Content />
          </main>
          {showLectureChrome && (
            <div className="shrink-0 pt-2">
              <ProgressPanel course={course} />
            </div>
          )}
        </div>

        {showLectureChrome && <PromptInput disabled={course.currentStepId === null} />}
      </div>

      <Dialogs />
      <DevPanel />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
