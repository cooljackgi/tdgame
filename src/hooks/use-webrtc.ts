

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
    onGameDataMessage: (msg: NetMsg) => void,
    onActionMessage: (msg: NetMsg) => void,
): UseWebRTCReturn {
    const [isConnected, setIsConnected] = useState(false);
    
    // Stats state
    const [packetsPerSecond, setPacketsPerSecond] = useState(0);
    const [bytesPerSecond, setBytesPerSecond] = useState(0);
    const [averagePacketSize, setAveragePacketSize] = useState(0);
    const [sentPacketsPerSecond, setSentPacketsPerSecond] = useState(0);
    const [sentBytesPerSecond, setSentBytesPerSecond] = useState(0);

    const signalingSocketRef = useRef<WebSocket | null>(null);
    const selfIdRef = useRef<string>(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    
    // Refs for reconnect logic & state management inside useEffect
    const gameIdRef = useRef(gameId);
    const userRef = useRef(user);
    const isHostRef = useRef(isHost);
    const isMonitorRef = useRef(isMonitor);
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
        onActionMessageRef.current = onActionMessage;
    }, [onGameDataMessage, onActionMessage]);

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


    // Update refs whenever props change
    useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { isHostRef.current = isHost; }, [isHost]);
    useEffect(() => { isMonitorRef.current = isMonitor; }, [isMonitor]);
    
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


    const createPeerConnection = useCallback(() => {
        const gid = gameIdRef.current;
        const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');
        if (!gid) return null;

        logWebRTCEvent(gid, currentRole, 'PC_CREATED');
        const pc = new RTCPeerConnection(iceConfiguration);
        
        async function logSelectedCandidatePair(pc: RTCPeerConnection) {
            const currentGid = gameIdRef.current;
            if(!currentGid) return;
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
                    logWebRTCEvent(currentGid, currentRole, 'ICE_SELECTED', {
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
                if (gid) logWebRTCEvent(gid, currentRole, 'PC_ICE_CANDIDATE', { candidate: event.candidate.candidate });
            }
        };
        
        pc.onconnectionstatechange = () => {
            const currentGid = gameIdRef.current;
            if (!currentGid) return;
            logWebRTCEvent(currentGid, currentRole, 'PC_CONNECTION_STATE_CHANGE', { state: pc.connectionState });
            if (pc.connectionState === 'connected') {
                logSelectedCandidatePair(pc);
            }
             if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                setIsConnected(false);
            }
        };
        
        pc.ondatachannel = (event) => {
            const dc = event.channel;
            const currentGid = gameIdRef.current;
            if (currentGid) logWebRTCEvent(currentGid, currentRole, 'DC_CREATED', { label: dc.label });
            
            dc.onopen = () => {
                const isGameOpen = gameDataChannelRef.current?.readyState === 'open';
                const isActionsOpen = actionsChannelRef.current?.readyState === 'open';
                setIsConnected(isGameOpen && isActionsOpen);
            };

            dc.onclose = () => {
                const isGameOpen = gameDataChannelRef.current?.readyState === 'open';
                const isActionsOpen = actionsChannelRef.current?.readyState === 'open';
                setIsConnected(isGameOpen && isActionsOpen);
            };

            dc.onmessage = (event) => {
                const msg: NetMsg = JSON.parse(event.data);
                packetCountRef.current++;
                byteCountRef.current += event.data.length;
                if (dc.label === 'game_data') {
                    onGameDataMessageRef.current(msg);
                } else if (dc.label === 'actions') {
                    onActionMessageRef.current(msg);
                }
            };
            
            if (dc.label === 'game_data') {
                gameDataChannelRef.current = dc;
            } else if (dc.label === 'actions') {
                actionsChannelRef.current = dc;
            }
        };

        return pc;
    }, []);
    
    useEffect(() => {
        let stopped = false;
        
        const connect = () => {
             if (stopped || !gameIdRef.current || !userRef.current) {
              if (!stopped) setTimeout(connect, 200);
              return;
            }

            const gid = gameIdRef.current;
            const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');

            if (signalingSocketRef.current && signalingSocketRef.current.readyState < WebSocket.CLOSING) {
                signalingSocketRef.current.close();
            }

            const signalingUrl = getSignalingUrl(gid, isMonitorRef.current);
            logWebRTCEvent(gid, currentRole, 'SIGNALING_CONNECTING', { url: signalingUrl });
            const ws = new WebSocket(signalingUrl);
            signalingSocketRef.current = ws;

            const scheduleReconnect = () => {
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              if (!stopped) {
                const delay = Math.min(30000, 1000 * Math.pow(2, backoffRef.current));
                backoffRef.current++;
                logWebRTCEvent(gid, currentRole, 'SIGNALING_RECONNECT_SCHEDULED', { delay });
                reconnectTimerRef.current = setTimeout(connect, delay);
              }
            };
            
            ws.onopen = () => {
                backoffRef.current = 0;
                logWebRTCEvent(gid, currentRole, 'SIGNALING_OPEN');
                if (!isHostRef.current) {
                    const sendHello = () => {
                       if (ws.readyState === WebSocket.OPEN) {
                         const msg = { kind:'signal', type:'hello', from:selfIdRef.current };
                         ws.send(JSON.stringify(msg));
                       }
                    };
                    sendHello();
                    if(helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                    helloIntervalRef.current = setInterval(sendHello, 2000);
                }
            };
            
            ws.onmessage = async (event) => {
                const msg = JSON.parse(event.data);
                if (msg.from && msg.from === selfIdRef.current) return;
                
                logWebRTCEvent(gid, currentRole, 'SIGNALING_MESSAGE_RECEIVED', { type: msg.type });

                if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed') {
                    peerConnectionRef.current = createPeerConnection();
                }
                const pc = peerConnectionRef.current;
                if(!pc) return;
                
                try {
                    if (msg.type === 'hello' && isHostRef.current) {
                        if (pc.signalingState !== 'stable') return;

                        if (!gameDataChannelRef.current || gameDataChannelRef.current.readyState !== 'open') {
                          const gdc = pc.createDataChannel('game_data', { ordered: false, maxRetransmits: 0 });
                          logWebRTCEvent(gid, currentRole, 'DC_CREATED', { label: gdc.label });
                          gameDataChannelRef.current = gdc;
                        }
                        if(!actionsChannelRef.current || actionsChannelRef.current.readyState !== 'open') {
                            const ac = pc.createDataChannel('actions', { ordered: true });
                            logWebRTCEvent(gid, currentRole, 'DC_CREATED', { label: ac.label });
                            actionsChannelRef.current = ac;
                        }
                        
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        const offerMsg = { kind:'signal', type:'offer', from:selfIdRef.current, payload: pc.localDescription };
                        ws.send(JSON.stringify(offerMsg));
                        logWebRTCEvent(gid, currentRole, 'PC_OFFER_CREATED_REHELLO');
                    
                    } else if (msg.type === 'offer' && !isHostRef.current) {
                        if(helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                        helloIntervalRef.current = undefined;

                        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        if (ws.readyState === WebSocket.OPEN) {
                          const answerMsg = { kind:'signal', type:'answer', from:selfIdRef.current, payload: pc.localDescription };
                          ws.send(JSON.stringify(answerMsg));
                        }
                    
                    } else if (msg.type === 'answer' && isHostRef.current) {
                         await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                    
                    } else if (msg.type === 'ice-candidate') {
                        const cand = msg.payload;
                        if (!pc.remoteDescription || !cand || (!cand.candidate && cand.candidate !== '')) return;
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
                logWebRTCEvent(gid, currentRole, 'SIGNALING_CLOSE', { code: e.code, reason: e.reason.toString() });
                setIsConnected(false);
                gameDataChannelRef.current = null;
                actionsChannelRef.current = null;
                if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                scheduleReconnect();
            };

            ws.onerror = (err) => {
                logWebRTCEvent(gid, currentRole, 'SIGNALING_ERROR', { err: String(err) });
            };
        };

        connect();

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

            packetCountRef.current = 0;
            byteCountRef.current = 0;
            sentPacketCountRef.current = 0;
            sentByteCountRef.current = 0;
        }, 1000);

        periodicLogIntervalRef.current = setInterval(() => {
            const gid = gameIdRef.current;
            if (gid && (gameDataChannelRef.current?.readyState === 'open' || actionsChannelRef.current?.readyState === 'open')) {
                const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');
                logWebRTCEvent(gid, currentRole, 'NET_TICK', {
                    pps: ppsRef.current,
                    bps: bpsRef.current,
                    avg: avgRef.current,
                });
            }
        }, 5000);

        return () => {
            stopped = true;
            if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
            if (periodicLogIntervalRef.current) clearInterval(periodicLogIntervalRef.current);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
            
            const ws = signalingSocketRef.current;
            if (ws) {
              ws.onclose = null;
              ws.close();
            }
            if (peerConnectionRef.current) peerConnectionRef.current.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { sendAction, sendGameData, isConnected, packetsPerSecond, bytesPerSecond, averagePacketSize, sentPacketsPerSecond, sentBytesPerSecond };
}
