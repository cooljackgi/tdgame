

"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { logWebRTCEvent } from '@/lib/logging';
import type { User } from 'firebase/auth';

const RELAY_DEFAULT = 'wss://ws-relay-345017018409.us-central1.run.app';

const iceConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_URL!.split(',').map(s => s.trim()),
          username: process.env.NEXT_PUBLIC_TURN_USER || '',
          credential: process.env.NEXT_PUBLIC_TURN_CRED || '',
        } as RTCIceServer]
      : []),
  ],
  iceTransportPolicy: 'all',
};

export type NetMsg<T = any> = {
    type: string;
    payload: T;
};

export type UseWebRTCReturn = {
    sendAction: (type: string, payload: any) => void;
    sendGameData: (type: string, payload: any) => void;
    isConnected: boolean; 
    packetsPerSecond: number;
    bytesPerSecond: number;
    averagePacketSize: number;
    sentPacketsPerSecond: number;
    sentBytesPerSecond: number;
    fps: number; // Added for host FPS
};

const getSignalingUrl = (gameId: string, isMonitor: boolean): string => {
  const q = `?gameId=${encodeURIComponent(gameId)}&monitor=${isMonitor ? '1' : '0'}`;
  const envBase = process.env.NEXT_PUBLIC_WS_BASE;
  const base = (envBase ? envBase.replace(/\/ws$/, '') : RELAY_DEFAULT);
  return `${base}/ws${q}`;
};


export function useWebRTC(
    gameId: string | null, 
    isHost: boolean, 
    user: User | null, 
    isMonitor: boolean = false,
    onGameDataMessage?: (msg: NetMsg) => void,
    onActionMessage?: (msg: NetMsg) => void,
): UseWebRTCReturn {
    const [isConnected, setIsConnected] = useState(false);
    
    // Stats state
    const [packetsPerSecond, setPacketsPerSecond] = useState(0);
    const [bytesPerSecond, setBytesPerSecond] = useState(0);
    const [averagePacketSize, setAveragePacketSize] = useState(0);
    const [sentPacketsPerSecond, setSentPacketsPerSecond] = useState(0);
    const [sentBytesPerSecond, setSentBytesPerSecond] = useState(0);
    const [fps, setFps] = useState(0); // For host FPS

    const signalingSocketRef = useRef<WebSocket | null>(null);
    const selfIdRef = useRef<string>(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    
    // Refs for reconnect logic & state management inside useEffect
    const backoffRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
    const helloIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>();
    
    // Refs for data channels to create stable send functions
    const gameDataChannelRef = useRef<RTCDataChannel | null>(null);
    const actionsChannelRef = useRef<RTCDataChannel | null>(null);
    
    // Stabilize callbacks with refs
    const onGameDataMessageRef = useRef(onGameDataMessage);
    const onActionMessageRef = useRef(onActionMessage);
    useEffect(() => {
        onGameDataMessageRef.current = onGameDataMessage;
    }, [onGameDataMessage]);
     useEffect(() => {
        onActionMessageRef.current = onActionMessage;
    }, [onActionMessage]);


    // Stats refs
    const packetCountRef = useRef(0);
    const byteCountRef = useRef(0);
    const sentPacketCountRef = useRef(0);
    const sentByteCountRef = useRef(0);
    const statsIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>();
    const periodicLogIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>();
    const ppsRef = useRef(0);
    const bpsRef = useRef(0);
    const avgRef = useRef(0);
    const sentPpsRef = useRef(0);
    const sentBpsRef = useRef(0);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    
    // Stable send functions that use refs
    const sendGameData = useCallback((type: string, payload: any) => {
        const channel = gameDataChannelRef.current;
        if (channel && channel.readyState === 'open') {
            const msgStr = JSON.stringify({ type, payload });
            channel.send(msgStr);
            sentPacketCountRef.current++;
            sentByteCountRef.current += msgStr.length;
        }
    }, []);
    
    const sendAction = useCallback((type: string, payload: any) => {
        const channel = actionsChannelRef.current;
        if (channel && channel.readyState === 'open') {
            const msgStr = JSON.stringify({ type, payload });
            channel.send(msgStr);
            sentPacketCountRef.current++;
            sentByteCountRef.current += msgStr.length;
        }
    }, []);

    const flushPendingIceCandidates = useCallback(() => {
        const pc = peerConnectionRef.current;
        if (!pc || !pc.remoteDescription) return;
        const candidates = pendingIceCandidatesRef.current.splice(0);
        for (const cand of candidates) {
            try {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn('Flushed ICE add failed', e));
            } catch (e) {
                console.warn('Flushed ICE candidate error', e);
            }
        }
    }, []);

    const setupDataChannelEvents = useCallback((dc: RTCDataChannel) => {
        const handleOpen = () => {
            if (!gameId) return;
            logWebRTCEvent(gameId, isHost ? 'host' : 'client', dc.label === 'game_data' ? 'DC_OPEN' : 'DC_OPEN', { label: dc.label });
            const isGameOpen = gameDataChannelRef.current?.readyState === 'open';
            const isActionsOpen = actionsChannelRef.current?.readyState === 'open';
            if (isGameOpen && isActionsOpen) setIsConnected(true);
        };

        const handleClose = () => {
            if (gameId) logWebRTCEvent(gameId, isHost ? 'host' : 'client', dc.label === 'game_data' ? 'DC_CLOSE' : 'DC_CLOSE', { label: dc.label });
            setIsConnected(false);
        };

        dc.onopen = handleOpen;
        dc.onclose = handleClose;

        dc.onmessage = (event) => {
            try {
                const msg: NetMsg = JSON.parse(event.data);
                packetCountRef.current++;
                byteCountRef.current += event.data.length;
                if (dc.label === 'game_data' && onGameDataMessageRef.current) {
                    onGameDataMessageRef.current(msg);
                } else if (dc.label === 'actions' && onActionMessageRef.current) {
                    onActionMessageRef.current(msg);
                }
            } catch (e) {
                console.error("Failed to parse RTC message:", e);
            }
        };

        if (dc.label === 'game_data') {
            gameDataChannelRef.current = dc;
        } else if (dc.label === 'actions') {
            actionsChannelRef.current = dc;
        }
    }, [gameId, isHost]);

    const createPeerConnection = useCallback((gid: string, role: string) => {
        if (!gid) return null;

        logWebRTCEvent(gid, role, 'PC_CREATED');
        const pc = new RTCPeerConnection(iceConfiguration);
        
        async function logSelectedCandidatePair(pc: RTCPeerConnection) {
            if(!gid) return;
            try {
                const stats = await pc.getStats();
                let selected: RTCStats | undefined;
                stats.forEach(report => { 
                    if (report.type === 'transport' && report.selectedCandidatePairId) {
                        selected = stats.get(report.selectedCandidatePairId);
                    }
                });

                if (selected && selected.type === 'candidate-pair') {
                    const local = stats.get(selected.localCandidateId);
                    const remote = stats.get(selected.remoteCandidateId);
                    logWebRTCEvent(gid, role, 'ICE_SELECTED', {
                        local: { type: local?.candidateType, ip: local?.ip, protocol: local?.protocol },
                        remote:{ type: remote?.candidateType, ip: remote?.ip, protocol: remote?.protocol }
                    });
                }
            } catch(e) {
                console.warn("Could not get WebRTC stats", e);
            }
        }

        pc.onicecandidate = (event) => {
            if (event.candidate && signalingSocketRef.current?.readyState === WebSocket.OPEN) {
                const msg = {
                  kind: 'signal',
                  type: 'ice-candidate',
                  from: selfIdRef.current,
                  payload: event.candidate
                };
                signalingSocketRef.current.send(JSON.stringify(msg));
                if (gid) logWebRTCEvent(gid, role, 'PC_ICE_CANDIDATE', { candidate: event.candidate.candidate });
            }
        };
        
        pc.onconnectionstatechange = () => {
            if (!gid) return;
            logWebRTCEvent(gid, role, 'PC_CONNECTION_STATE_CHANGE', { state: pc.connectionState });
            if (pc.connectionState === 'connected') {
                logSelectedCandidatePair(pc);
            }
             if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                setIsConnected(false);
            }
        };
        
        pc.ondatachannel = (event) => {
            const dc = event.channel;
            if (gid) logWebRTCEvent(gid, role, 'DC_CREATED', { label: dc.label });
            setupDataChannelEvents(dc);
        };

        return pc;
    }, [setupDataChannelEvents]);
    
    useEffect(() => {
        if (!gameId || !user || typeof isHost !== 'boolean') {
            return;
        }

        let stopped = false;
        
        const cleanup = () => {
            if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = undefined; }
            if (periodicLogIntervalRef.current) { clearInterval(periodicLogIntervalRef.current); periodicLogIntervalRef.current = undefined; }
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
            
            const ws = signalingSocketRef.current;
            if (ws) {
              ws.onclose = null;
              ws.close();
              signalingSocketRef.current = null;
            }
            const pc = peerConnectionRef.current;
            if (pc) {
                pc.onconnectionstatechange = null;
                pc.onicecandidate = null;
                pc.ondatachannel = null;
                pc.close();
                peerConnectionRef.current = null;
            }
            setIsConnected(false);
            gameDataChannelRef.current = null;
            actionsChannelRef.current = null;
        }
        
        const connect = () => {
             if (stopped) return;

            const currentRole = isMonitor ? 'monitor' : (isHost ? 'host' : 'client');

            if (signalingSocketRef.current && signalingSocketRef.current.readyState < WebSocket.CLOSING) {
                signalingSocketRef.current.close();
            }

            const signalingUrl = getSignalingUrl(gameId, isMonitor);
            logWebRTCEvent(gameId, currentRole, 'SIGNALING_CONNECTING', { url: signalingUrl });
            const ws = new WebSocket(signalingUrl);
            signalingSocketRef.current = ws;

            const scheduleReconnect = () => {
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              if (!stopped) {
                const delay = Math.min(30000, 1000 * Math.pow(2, backoffRef.current));
                backoffRef.current++;
                logWebRTCEvent(gameId, currentRole, 'SIGNALING_RECONNECT_SCHEDULED', { delay });
                reconnectTimerRef.current = setTimeout(connect, delay);
              }
            };
            
            ws.onopen = () => {
                backoffRef.current = 0;
                logWebRTCEvent(gameId, currentRole, 'SIGNALING_OPEN');
                const sendHello = () => {
                   if (ws.readyState === WebSocket.OPEN) {
                     const msg = { kind:'signal', type:'hello', from:selfIdRef.current };
                     ws.send(JSON.stringify(msg));
                   }
                };
                sendHello();
                if(helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                helloIntervalRef.current = setInterval(sendHello, 10000); // Send hello more frequently for rejoin
            };
            
            ws.onmessage = async (event) => {
                const msg = JSON.parse(event.data);
                if (msg.from && msg.from === selfIdRef.current) return;
                
                if (msg.type === 'hello' && isHost) {
                    if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed') {
                      peerConnectionRef.current = createPeerConnection(gameId, currentRole);
                    }
                    const pc = peerConnectionRef.current!;
                    if (pc.signalingState !== 'stable' || (pc.connectionState === 'connected' && gameDataChannelRef.current?.readyState === 'open')) {
                      return;
                    }
                    if (!gameDataChannelRef.current || gameDataChannelRef.current.readyState !== 'open') {
                      const gdc = pc.createDataChannel('game_data', { ordered: false, maxRetransmits: 0 });
                      setupDataChannelEvents(gdc);
                    }
                    if (!actionsChannelRef.current || actionsChannelRef.current.readyState !== 'open') {
                      const ac = pc.createDataChannel('actions', { ordered: true });
                      setupDataChannelEvents(ac);
                    }
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    if (signalingSocketRef.current?.readyState === WebSocket.OPEN) {
                      signalingSocketRef.current.send(JSON.stringify({
                        kind:'signal', type:'offer', from:selfIdRef.current, payload: pc.localDescription
                      }));
                      logWebRTCEvent(gameId, currentRole, 'PC_OFFER_CREATED_REHELLO');
                    }
                    return;
                }

                if(msg.type === 'ping') {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
                    return;
                }

                logWebRTCEvent(gameId, currentRole, 'SIGNALING_MESSAGE_RECEIVED', { type: msg.type });

                if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed') {
                    peerConnectionRef.current = createPeerConnection(gameId, currentRole);
                }
                const pc = peerConnectionRef.current;
                if(!pc) return;
                
                try {
                    if (msg.type === 'offer' && !isHost) {
                        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                        flushPendingIceCandidates();
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        if (ws.readyState === WebSocket.OPEN) {
                          const answerMsg = { kind:'signal', type:'answer', from:selfIdRef.current, payload: pc.localDescription };
                          ws.send(JSON.stringify(answerMsg));
                        }
                    
                    } else if (msg.type === 'answer' && isHost) {
                         await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                         flushPendingIceCandidates();
                    
                    } else if (msg.type === 'ice-candidate') {
                        const cand = msg.payload;
                        if (!cand || (!cand.candidate && cand.candidate !== '')) return;
                        if (!pc.remoteDescription) {
                            pendingIceCandidatesRef.current.push(cand);
                            return;
                        }
                        try {
                           await pc.addIceCandidate(new RTCIceCandidate(cand));
                        } catch (e) {
                           console.warn('addIceCandidate failed', e, cand);
                        }
                    }
                } catch (e) {
                    console.error("Error handling signaling message:", e, msg);
                }
            };
            
            ws.onclose = (e) => {
                logWebRTCEvent(gameId, currentRole, 'SIGNALING_CLOSE', { code: e.code, reason: e.reason.toString() });
                setIsConnected(false);
                gameDataChannelRef.current = null;
                actionsChannelRef.current = null;
                if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                scheduleReconnect();
            };

            ws.onerror = (err) => {
                logWebRTCEvent(gameId, currentRole, 'SIGNALING_ERROR', { err: String(err) });
            };
        };

        cleanup();
        connect();

        if (!statsIntervalRef.current) {
            statsIntervalRef.current = setInterval(() => {
                const pps = packetCountRef.current;
                const bps = byteCountRef.current;
                const sentPps = sentPacketCountRef.current;
                const sentBps = sentByteCountRef.current;
                const avg = pps ? Math.round(bps / Math.max(1, pps)) : 0;
                
                setPacketsPerSecond(pps);
                setBytesPerSecond(bps);
                setAveragePacketSize(avg);
                setSentPacketsPerSecond(sentPps);
                setSentBytesPerSecond(sentBps);
                
                ppsRef.current = pps;
                bpsRef.current = bps;
                avgRef.current = avg;
                sentPpsRef.current = sentPps;
                sentBpsRef.current = sentBps;

                packetCountRef.current = 0;
                byteCountRef.current = 0;
                sentPacketCountRef.current = 0;
                sentByteCountRef.current = 0;
            }, 1000);
        }

        if (!periodicLogIntervalRef.current) {
            periodicLogIntervalRef.current = setInterval(() => {
                const currentGid = gameId;
                if (currentGid && (gameDataChannelRef.current?.readyState === 'open' || actionsChannelRef.current?.readyState === 'open')) {
                    const currentRole = isMonitor ? 'monitor' : (isHost ? 'host' : 'client');
                    logWebRTCEvent(currentGid, currentRole, 'NET_TICK', {
                        pps: ppsRef.current,
                        bps: bpsRef.current,
                        avg: avgRef.current,
                        txPps: isHost ? sentPpsRef.current : undefined,
                        txBps: isHost ? sentBpsRef.current : undefined,
                        rxPps: !isHost ? ppsRef.current : undefined,
                        rxBps: !isHost ? bpsRef.current : undefined,
                    });
                }
            }, 5000);
        }

        return () => {
            stopped = true;
            cleanup();
        };
    }, [gameId, isHost, user, isMonitor, createPeerConnection, setupDataChannelEvents]);

    return { sendAction, sendGameData, isConnected, packetsPerSecond, bytesPerSecond, averagePacketSize, sentPacketsPerSecond, sentBytesPerSecond, fps };
}
