import { useEffect } from 'react'
import { useStore } from '../store'
import { api, courseFromDetail } from '../api'
import type { Course } from '../types'

const PHASES = [
  { key: 'outline', label: 'ステップに分解しています' },
  { key: 'quiz', label: '確認テストを作成しています' },
] as const

/** SC-05 生成中。§7.4「フロントエンドは2秒間隔でポーリングする」 */
export function Generating({ course }: { course: Course }) {
  const { dispatch } = useStore()
  const activeIndex = course.phase === 'quiz' ? 1 : 0

  const isMock = course.isMock === true

  useEffect(() => {
    // 開発パネルのモック講義はサーバーに存在しないため、従来どおりタイマーで模擬する
    if (isMock) {
      const t1 = setTimeout(
        () => dispatch({ type: 'generationPhase', courseId: course.id, phase: 'quiz' }),
        2200,
      )
      const t2 = setTimeout(() => dispatch({ type: 'generationDone', courseId: course.id }), 4600)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }

    let alive = true
    const timer = setInterval(() => {
      api
        .course(course.id)
        .then((detail) => {
          if (alive) dispatch({ type: 'courseUpdated', course: courseFromDetail(detail) })
        })
        .catch(() => {
          // 一時的な失敗は次の周期で拾い直す。生成はサーバー側で続いている（§4.1.6 途中離脱）
        })
    }, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [course.id, isMock, dispatch])

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-semibold text-slate-800">
        「{course.title}」を作成しています
      </p>

      <ol className="mt-8 w-full max-w-md space-y-3 text-left">
        {PHASES.map((p, i) => {
          const done = i < activeIndex
          const active = i === activeIndex
          return (
            <li key={p.key} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? 'bg-emerald-100 text-emerald-700'
                    : active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-sm ${active ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                {p.label}
              </span>
              {active && (
                <span className="ml-auto flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        1〜2分程度かかります。
        <br />
        この画面を閉じても作成は続きます。
      </p>
    </div>
  )
}
