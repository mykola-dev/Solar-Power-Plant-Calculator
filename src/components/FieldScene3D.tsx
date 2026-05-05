import { Box, Button, Group, Text } from '@mantine/core'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Text as DreiText, Line } from '@react-three/drei'
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { FieldLayout, SolarMetrics } from '../types'
import { compassDirectionENU, enuToThree, sunVectorToSkyENU } from '../utils/solar3d'

type FieldScene3DProps = {
  fieldLayout: FieldLayout
  rowHeightStepM: number
  metrics: SolarMetrics
  panelAzimuthDeg: number
  groundTiltDeg: number
  groundTiltAzimuthDeg: number
  rowShadingFractions: number[]
  windAzimuthDeg: number
  windSpeedMs: number
  mountHeightM: number
}

type CameraHandle = {
  top: () => void
  side: () => void
  orbit: () => void
}

const DEG_TO_RAD = Math.PI / 180

const CompassLabels = React.memo(() => (
  <group position={[0, 0.05, 0]}>
    <DreiText position={[0, 0, -11.5]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      N
    </DreiText>
    <DreiText position={[0, 0, 11.5]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      S
    </DreiText>
    <DreiText position={[11.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      E
    </DreiText>
    <DreiText position={[-11.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      W
    </DreiText>
  </group>
))
CompassLabels.displayName = 'CompassLabels'

const FieldBoundary = React.memo(({ fieldLayout, panelAzimuthDeg }: Pick<FieldScene3DProps, 'fieldLayout' | 'panelAzimuthDeg'>) => {
  if (fieldLayout.rows.length === 0) {
    return null
  }

  const azimuthRad = panelAzimuthDeg * DEG_TO_RAD
  const halfW = fieldLayout.fieldWidthM / 2
  const fieldDepthM = fieldLayout.fieldDepthM
  const margin = 0.15
  const yLift = 0.05
  const points: [number, number, number][] = [
    [-halfW - margin, yLift, margin],
    [halfW + margin, yLift, margin],
    [halfW + margin, yLift, -fieldDepthM - margin],
    [-halfW - margin, yLift, -fieldDepthM - margin],
    [-halfW - margin, yLift, margin],
  ]

  return (
    <group rotation={[0, Math.PI - azimuthRad, 0]}>
      <Line points={points} color="#a5d3f5" lineWidth={3} dashed dashSize={0.5} dashScale={2} gapSize={0.2} />
      <DreiText position={[0, yLift + 0.1, margin + 0.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.6} color="#a5d3f5" anchorX="center" anchorY="middle">
        {`${fieldLayout.fieldWidthM.toFixed(2)} m`}
      </DreiText>
      <DreiText
        position={[halfW + margin + 0.4, yLift + 0.1, -fieldDepthM / 2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        fontSize={0.6}
        color="#a5d3f5"
        anchorX="center"
        anchorY="middle"
      >
        {`${fieldDepthM.toFixed(2)} m`}
      </DreiText>
    </group>
  )
})
FieldBoundary.displayName = 'FieldBoundary'

const RowPanels = React.memo(({
  rowIndex,
  fieldWidthM,
  row,
  rowHeightStepLocal,
  face,
  panelAzimuthDeg,
  shadingFraction,
  mountHeightM,
}: {
  rowIndex: number
  fieldWidthM: number
  row: FieldLayout['rows'][number]
  rowHeightStepLocal: THREE.Vector3
  face: ReturnType<typeof compassDirectionENU>
  panelAzimuthDeg: number
  shadingFraction: number
  mountHeightM: number
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const azimuthRad = panelAzimuthDeg * DEG_TO_RAD
  const halfThickness = 0.018
  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BoxGeometry(Math.max(row.panelWidthAcrossRowM, 0.25), halfThickness, row.panelLengthM)
    nextGeometry.translate(0, halfThickness / 2, -row.panelLengthM / 2)
    return nextGeometry
  }, [halfThickness, row.panelLengthM, row.panelWidthAcrossRowM])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.33, metalness: 0.14 }), [])
  const panelTiltRad = Math.atan2(row.panelTopHeightM, Math.max(row.panelRunM, 0.01))

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) {
      return
    }

    const dummy = new THREE.Object3D()
    const colorObj = new THREE.Color(shadingFraction > 0.65 ? '#4f7da8' : shadingFraction > 0.2 ? '#5a8fbc' : '#73afe6')
    const enuBaseX = -face.x * row.baseOffsetM
    const enuBaseY = -face.y * row.baseOffsetM
    const centeredLeftOffset = row.leftEdgeOffsetM - fieldWidthM / 2
    const threeX = enuBaseX + rowHeightStepLocal.x * rowIndex
    const threeY = mountHeightM + rowHeightStepLocal.y * rowIndex
    const threeZ = -enuBaseY + rowHeightStepLocal.z * rowIndex

    for (let panelIndex = 0; panelIndex < row.panelsCount; panelIndex += 1) {
      const xOffset = centeredLeftOffset + row.panelWidthAcrossRowM / 2 + panelIndex * (row.panelWidthAcrossRowM + row.panelGapM)
      dummy.position.set(threeX, threeY, threeZ)
      dummy.rotation.set(0, Math.PI - azimuthRad, 0)
      dummy.updateMatrix()

      const panelMatrix = new THREE.Matrix4()
      panelMatrix.makeRotationX(panelTiltRad)
      panelMatrix.setPosition(xOffset, 0, 0)

      dummy.matrix.multiply(panelMatrix)
      mesh.setMatrixAt(panelIndex, dummy.matrix)
      mesh.setColorAt(panelIndex, colorObj)
    }

    mesh.count = row.panelsCount
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [azimuthRad, face.x, face.y, fieldWidthM, mountHeightM, panelTiltRad, row, rowHeightStepLocal, rowIndex, shadingFraction])

  return <instancedMesh ref={meshRef} args={[geometry, material, Math.max(row.panelsCount, 1)]} castShadow receiveShadow />
})
RowPanels.displayName = 'RowPanels'

const PanelRows = React.memo(({
  fieldLayout,
  rowHeightStepM,
  panelAzimuthDeg,
  groundTiltDeg,
  groundTiltAzimuthDeg,
  rowShadingFractions,
  mountHeightM,
}: Pick<FieldScene3DProps, 'fieldLayout' | 'rowHeightStepM' | 'panelAzimuthDeg' | 'groundTiltDeg' | 'groundTiltAzimuthDeg' | 'rowShadingFractions' | 'mountHeightM'>) => {
  const face = compassDirectionENU(panelAzimuthDeg)
  const rowHeightStepSafeM = Math.max(rowHeightStepM, 0)

  const rowHeightStepLocal = useMemo(() => {
    const groundTiltRad = -groundTiltDeg * DEG_TO_RAD
    const tiltAxisENU = compassDirectionENU((groundTiltAzimuthDeg ?? 0) + 90)
    const tiltAxisThree = new THREE.Vector3(tiltAxisENU.x, 0, -tiltAxisENU.y)
    const groundQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxisThree, groundTiltRad)

    return new THREE.Vector3(0, rowHeightStepSafeM, 0).applyQuaternion(groundQuat.invert())
  }, [rowHeightStepSafeM, groundTiltDeg, groundTiltAzimuthDeg])

  return (
    <group>
      {fieldLayout.rows.map((row, rowIndex) => (
        <RowPanels
          key={`${rowIndex}-${row.orientation}-${row.panelsCount}-${row.panelLengthM}-${row.panelWidthAcrossRowM}`}
          rowIndex={rowIndex}
          fieldWidthM={fieldLayout.fieldWidthM}
          row={row}
          rowHeightStepLocal={rowHeightStepLocal}
          face={face}
          panelAzimuthDeg={panelAzimuthDeg}
          shadingFraction={rowShadingFractions[rowIndex] ?? 0}
          mountHeightM={mountHeightM}
        />
      ))}
    </group>
  )
})
PanelRows.displayName = 'PanelRows'

const SunSphere = React.memo(({ solarAzimuthDeg, solarAltitudeDeg, sunAboveHorizon }: { solarAzimuthDeg: number; solarAltitudeDeg: number; sunAboveHorizon: boolean }) => {
  if (!sunAboveHorizon) return null
  const dist = 55
  const dir = sunVectorToSkyENU(solarAzimuthDeg, solarAltitudeDeg)
  const pos = enuToThree({ x: dir.x * dist, y: dir.y * dist, z: Math.max(dir.z * dist, 1) })
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[2.6, 24, 24]} />
        <meshBasicMaterial color="#ffe566" />
      </mesh>
      <mesh>
        <sphereGeometry args={[3.8, 16, 16]} />
        <meshBasicMaterial color="#ffdd33" transparent opacity={0.13} depthWrite={false} />
      </mesh>
    </group>
  )
})
SunSphere.displayName = 'SunSphere'

const WindArrow = React.memo(({ azimuthDeg, speedMs }: { azimuthDeg: number; speedMs: number }) => {
  if (speedMs <= 0) return null

  const dirENU = compassDirectionENU(azimuthDeg)
  const posThree = enuToThree({ x: -dirENU.x * 15, y: -dirENU.y * 15, z: 7 })
  const azimuthRad = azimuthDeg * DEG_TO_RAD

  return (
    <group position={posThree} rotation={[0, Math.PI - azimuthRad, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 2]}>
        <cylinderGeometry args={[0.25, 0.25, 8, 8]} />
        <meshStandardMaterial color="#74c0fc" emissive="#74c0fc" emissiveIntensity={0.5} transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 6.5]}>
        <coneGeometry args={[0.9, 2.5, 12]} />
        <meshStandardMaterial color="#74c0fc" emissive="#74c0fc" emissiveIntensity={0.8} />
      </mesh>
      <DreiText position={[0, 1.8, 2]} fontSize={1.4} color="#74c0fc" rotation={[-Math.PI / 3, 0, 0]} anchorX="center" anchorY="middle">
        Wind {speedMs} m/s
      </DreiText>
    </group>
  )
})
WindArrow.displayName = 'WindArrow'

const CameraControls = forwardRef<CameraHandle, { controlsRef: React.RefObject<OrbitControlsImpl | null> }>(({ controlsRef }, ref) => {
  const { camera } = useThree()

  useImperativeHandle(ref, () => ({
    top() {
      camera.position.set(0, 28, 0.01)
      camera.lookAt(0, 0, 0)
      controlsRef.current?.update()
    },
    side() {
      camera.position.set(0, 5, 18)
      camera.lookAt(0, 2, 0)
      controlsRef.current?.update()
    },
    orbit() {
      camera.position.set(10, 6.5, 10)
      camera.lookAt(0, 0, 0)
      controlsRef.current?.update()
    },
  }))

  return null
})
CameraControls.displayName = 'CameraControls'

export function FieldScene3D(props: FieldScene3DProps) {
  const sunDistance = 20
  const sunToSky = sunVectorToSkyENU(props.metrics.solarAzimuthDeg, props.metrics.solarAltitudeDeg)
  const sunPosition = useMemo(() => enuToThree({
    x: sunToSky.x * sunDistance,
    y: sunToSky.y * sunDistance,
    z: Math.max(sunToSky.z * sunDistance, 0.5),
  }), [sunToSky.x, sunToSky.y, sunToSky.z])

  const groundQuat = useMemo(() => {
    const groundTiltRad = -props.groundTiltDeg * DEG_TO_RAD
    const tiltAxisENU = compassDirectionENU((props.groundTiltAzimuthDeg ?? 0) + 90)
    const tiltAxisThree = new THREE.Vector3(tiltAxisENU.x, 0, -tiltAxisENU.y)
    return new THREE.Quaternion().setFromAxisAngle(tiltAxisThree, groundTiltRad)
  }, [props.groundTiltDeg, props.groundTiltAzimuthDeg])

  const orbitRef = useRef<OrbitControlsImpl | null>(null)
  const cameraHandle = useRef<CameraHandle | null>(null)

  return (
    <Box>
      <Group justify="space-between" align="center" mb={8}>
        <Text size="sm" c="dimmed">3D preview - real sun shadows, orbit camera</Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.top()}>Top</Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.side()}>Side</Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.orbit()}>Reset</Button>
        </Group>
      </Group>
      <div className="scene3d-shell" role="img" aria-label="Solar panel 3D field preview">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [10, 6.5, 10], fov: 42 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.4
          }}
        >
          <color attach="background" args={['#1d2a3d']} />
          <hemisphereLight intensity={0.82} color="#dde9ff" groundColor="#5c6d59" />
          <ambientLight intensity={0.58} />
          <directionalLight
            castShadow
            intensity={props.metrics.sunAboveHorizon ? 2.2 : 0.08}
            color="#ffe2a7"
            position={sunPosition}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.00005}
            shadow-normalBias={0.0002}
          >
            <object3D attach="target" position={[0, 0, 0]} />
            <orthographicCamera attach="shadow-camera" args={[-24, 24, 24, -24, 0.1, 120]} />
          </directionalLight>
          <directionalLight intensity={0.5} color="#a7c3f4" position={[-8, 9, -10]} />

          <SunSphere
            solarAzimuthDeg={props.metrics.solarAzimuthDeg}
            solarAltitudeDeg={props.metrics.solarAltitudeDeg}
            sunAboveHorizon={props.metrics.sunAboveHorizon}
          />

          <group quaternion={groundQuat}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
              <planeGeometry args={[60, 60]} />
              <meshStandardMaterial color="#3b5344" roughness={0.94} metalness={0.02} />
            </mesh>

            <CompassLabels />
            <FieldBoundary fieldLayout={props.fieldLayout} panelAzimuthDeg={props.panelAzimuthDeg} />
            <PanelRows
              fieldLayout={props.fieldLayout}
              rowHeightStepM={props.rowHeightStepM}
              panelAzimuthDeg={props.panelAzimuthDeg}
              groundTiltDeg={props.groundTiltDeg}
              groundTiltAzimuthDeg={props.groundTiltAzimuthDeg}
              rowShadingFractions={props.rowShadingFractions}
              mountHeightM={props.mountHeightM}
            />
          </group>

          <WindArrow azimuthDeg={props.windAzimuthDeg} speedMs={props.windSpeedMs} />
          <CameraControls ref={cameraHandle} controlsRef={orbitRef} />
          <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.08} minDistance={4} maxDistance={36} maxPolarAngle={Math.PI * 0.49} />
        </Canvas>
      </div>
      {!props.metrics.sunAboveHorizon ? <Text mt={8} size="sm" c="dimmed">Sun is below horizon at selected time.</Text> : null}
    </Box>
  )
}
