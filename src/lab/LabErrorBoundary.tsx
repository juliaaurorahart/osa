import { Component, type ReactNode } from 'react'

type LabErrorBoundaryProps = {
  children: ReactNode
  labName: string
  onError?: () => void
  recoveryHint?: string
}

type LabErrorBoundaryState = {
  failed: boolean
}

/** Keeps a broken optional instrument from taking down the OSA shell around it. */
export class LabErrorBoundary extends Component<LabErrorBoundaryProps, LabErrorBoundaryState> {
  state: LabErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): LabErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch() { this.props.onError?.() }

  render() {
    if (this.state.failed) {
      return (
        <div className="lab-shell__error" role="alert">
          <strong>{this.props.labName} could not open.</strong>
          <span>{this.props.recoveryHint ?? 'Choose another instrument above, or reload OSA to retry this one.'}</span>
        </div>
      )
    }

    return this.props.children
  }
}
